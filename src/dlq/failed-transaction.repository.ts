import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FailedTransactionRecord,
  PrismaService,
  toFailedTransactionRecord,
} from '../prisma/prisma.service';

export interface CreateFailedTransactionInput {
  operation: string;
  escrowId?: string | null;
  errorMessage: string;
  /**
   * Stored as JSON. `null`/omitted becomes SQL NULL rather than the JSON
   * literal `null` — `Prisma.DbNull` is what expresses that in a create.
   */
  ledgerFeedback?: Record<string, unknown> | null;
  attempts?: number;
}

/** Filter accepted by {@link FailedTransactionRepository.findMany} / `count`. */
export type FailedTransactionFilter = Prisma.FailedTransactionWhereInput;

/**
 * Owns every `failedTransaction` query (R-DB-02, issue #844).
 *
 * The DLQ service keeps the state machine — which status transitions are
 * legal, what a replay failure does, what gets logged — while all persistence
 * lives here, so the controller and service never touch `PrismaService`
 * directly.
 */
@Injectable()
export class FailedTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Records a failed submission as a new `PENDING_REVIEW` row. */
  async create(
    input: CreateFailedTransactionInput,
  ): Promise<FailedTransactionRecord> {
    const row = await this.prisma.failedTransaction.create({
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
    return toFailedTransactionRecord(row);
  }

  /** Returns dead-letter rows matching `where`, newest first by default. */
  async findMany(options: {
    where?: FailedTransactionFilter;
    skip?: number;
    take?: number;
  }): Promise<FailedTransactionRecord[]> {
    const rows = await this.prisma.failedTransaction.findMany({
      where: options.where,
      orderBy: { createdAt: 'desc' },
      skip: options.skip,
      take: options.take,
    });
    return rows.map(toFailedTransactionRecord);
  }

  /** Counts dead-letter rows matching the same filter a page was taken from. */
  count(where?: FailedTransactionFilter): Promise<number> {
    return this.prisma.failedTransaction.count({ where });
  }

  /** Returns one dead-letter row, or null when the id is unknown. */
  async findById(id: string): Promise<FailedTransactionRecord | null> {
    const row = await this.prisma.failedTransaction.findUnique({
      where: { id },
    });
    return row ? toFailedTransactionRecord(row) : null;
  }

  /**
   * Bumps the attempts counter and records why the last attempt failed,
   * leaving the status untouched so the row stays available for review.
   */
  async incrementAttempts(
    id: string,
    errorMessage: string,
  ): Promise<FailedTransactionRecord> {
    const row = await this.prisma.failedTransaction.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        errorMessage,
      },
    });
    return toFailedTransactionRecord(row);
  }

  /** Marks a row `REPLAYED` with the transaction hash the replay produced. */
  async markReplayed(
    id: string,
    txHash: string,
  ): Promise<FailedTransactionRecord> {
    const row = await this.prisma.failedTransaction.update({
      where: { id },
      data: {
        status: 'REPLAYED',
        replayedAt: new Date(),
        lastReplayTxHash: txHash,
      },
    });
    return toFailedTransactionRecord(row);
  }

  /** Marks a row `ABANDONED` and stamps when an operator reviewed it. */
  async markAbandoned(id: string): Promise<FailedTransactionRecord> {
    const row = await this.prisma.failedTransaction.update({
      where: { id },
      data: {
        status: 'ABANDONED',
        reviewedAt: new Date(),
      },
    });
    return toFailedTransactionRecord(row);
  }

  /** Stamps `reviewedAt` without changing the status. */
  async markReviewed(id: string): Promise<FailedTransactionRecord> {
    const row = await this.prisma.failedTransaction.update({
      where: { id },
      data: {
        reviewedAt: new Date(),
      },
    });
    return toFailedTransactionRecord(row);
  }
}
