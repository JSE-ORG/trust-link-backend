import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  FailedTransaction as PrismaFailedTransaction,
} from '@prisma/client';
import {
  PrismaService,
  toFailedTransactionRecord,
} from '../prisma/prisma.service';
import {
  EnqueueFailedTransactionInput,
  FailedTransactionRecord,
  ListFailedTransactionsQuery,
  PaginatedFailedTransactions,
  ReplayFn,
} from './dlq.types';

/**
 * Issue #303 – Persistent dead-letter queue backed by Prisma.
 *
 * Migrates the in-memory DLQ to database-backed storage so failed Stellar
 * contract submissions survive application restarts. The API surface is
 * unchanged — existing callers see no difference.
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a failed Stellar contract submission as a new
   * `PENDING_REVIEW` dead-letter row for an operator to triage.
   *
   * Always inserts — there is no dedup on `escrowId` + `operation`, so a
   * caller that retries its own submission and fails again should enqueue
   * once, not per attempt (carry the running count in `input.attempts`).
   * `ledgerFeedback` is stored as JSON; pass `null`/omit it to store SQL
   * NULL rather than the JSON literal `null`.
   */
  async enqueue(
    input: EnqueueFailedTransactionInput,
  ): Promise<FailedTransactionRecord> {
    const record = await this.prisma.failedTransaction.create({
      data: {
        operation: input.operation,
        escrowId: input.escrowId ?? null,
        errorMessage: input.errorMessage,
        ledgerFeedback:
          input.ledgerFeedback == null
            ? Prisma.DbNull
            : (input.ledgerFeedback as Prisma.InputJsonValue),
        attempts: input.attempts ?? 1,
        status: 'PENDING_REVIEW',
      },
    });
    return this.toRecord(record);
  }

  /**
   * Returns a page of dead-letter rows, newest first, with optional
   * `status` / `operation` / `escrowId` filters.
   *
   * Pagination is clamped, not validated: `page` floors to 1 and `limit` is
   * forced into `[1, 100]` (default 20), so an out-of-range query returns a
   * best-effort page instead of a 400. `total` is the count for the same
   * filter, so `Math.ceil(total / limit)` gives the page count.
   */
  async list(
    query: ListFailedTransactionsQuery = {},
  ): Promise<PaginatedFailedTransactions> {
    const page = Math.max(1, Number(query.page) || 1);
    const rawLimit = Number(query.limit) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const skip = (page - 1) * limit;

    const where: Prisma.FailedTransactionWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.operation) where.operation = query.operation;
    if (query.escrowId) where.escrowId = query.escrowId;

    const [records, total] = await Promise.all([
      this.prisma.failedTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.failedTransaction.count({ where }),
    ]);

    return {
      data: records.map((r) => this.toRecord(r)),
      total,
      page,
      limit,
    };
  }

  /**
   * Returns one dead-letter row by id, or throws `NotFoundException`.
   *
   * There is no nullable variant — every internal state-changing method
   * (`replay`, `abandon`, `markReviewed`) funnels its existence check
   * through here, so a missing id is always a 404, never a silent no-op.
   */
  async get(id: string): Promise<FailedTransactionRecord> {
    const record = await this.prisma.failedTransaction.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException(`Failed transaction ${id} not found`);
    }
    return this.toRecord(record);
  }

  /**
   * Re-execute the original operation via `replay`. On success the record is
   * marked `REPLAYED` and the new tx hash is stored; on failure the attempts
   * counter is bumped and the record stays `PENDING_REVIEW` for further review.
   */
  async replay(id: string, replay: ReplayFn): Promise<FailedTransactionRecord> {
    const record = await this.requireRecord(id);
    if (record.status !== 'PENDING_REVIEW') {
      throw new Error(`Failed transaction ${id} is not pending review`);
    }

    let txHash: string;
    try {
      txHash = await replay(record);
    } catch (err: unknown) {
      await this.prisma.failedTransaction.update({
        where: { id },
        data: {
          attempts: { increment: 1 },
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      this.logger.warn(
        JSON.stringify({
          msg: 'dlq.replay.failed',
          failedTransactionId: id,
          operation: record.operation,
          attempts: record.attempts + 1,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      throw err;
    }

    const updated = await this.prisma.failedTransaction.update({
      where: { id },
      data: {
        status: 'REPLAYED',
        replayedAt: new Date(),
        lastReplayTxHash: txHash,
      },
    });
    return this.toRecord(updated);
  }

  /**
   * Marks a dead-letter row `ABANDONED` — an operator has decided the
   * failed operation will not be retried — and stamps `reviewedAt`.
   *
   * Terminal in practice: `replay` only acts on `PENDING_REVIEW` rows, so an
   * abandoned row can no longer be replayed through this service. Unlike
   * `replay` it does **not** check the current status, so calling it on an
   * already-`REPLAYED` row would overwrite the status — callers should only
   * abandon rows still pending review. Throws `NotFoundException` for an
   * unknown id.
   */
  async abandon(id: string): Promise<FailedTransactionRecord> {
    await this.requireRecord(id);
    const updated = await this.prisma.failedTransaction.update({
      where: { id },
      data: {
        status: 'ABANDONED',
        reviewedAt: new Date(),
      },
    });
    return this.toRecord(updated);
  }

  /**
   * Stamps `reviewedAt` without changing `status` — an operator has looked
   * at the row but is neither replaying nor abandoning it yet.
   *
   * Idempotent in effect (re-marking just moves the timestamp forward) and
   * leaves the row eligible for a later `replay`. Throws `NotFoundException`
   * for an unknown id.
   */
  async markReviewed(id: string): Promise<FailedTransactionRecord> {
    await this.requireRecord(id);
    const updated = await this.prisma.failedTransaction.update({
      where: { id },
      data: {
        reviewedAt: new Date(),
      },
    });
    return this.toRecord(updated);
  }

  private async requireRecord(id: string): Promise<FailedTransactionRecord> {
    return this.get(id);
  }

  private toRecord(row: PrismaFailedTransaction): FailedTransactionRecord {
    return toFailedTransactionRecord(row);
  }
}
