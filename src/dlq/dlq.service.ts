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
