import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  EnqueueFailedTransactionInput,
  FailedTransactionRecord,
  FailedTransactionStatus,
  ListFailedTransactionsQuery,
  ReplayFn,
} from './dlq.types';

/**
 * In-memory dead-letter queue for failed Stellar contract submissions (#74).
 *
 * Submitters (e.g. `ContractService`) call {@link enqueue} when a transaction
 * fails so the full ledger feedback is preserved; admins use the controller
 * endpoints to {@link list}, {@link get}, {@link replay} or {@link abandon}
 * records.
 *
 * The store is process-local on purpose — failed submissions matter most while
 * a single node is running; persistence can be swapped in later by replacing
 * the map with a Prisma model behind the same surface.
 */
@Injectable()
export class DlqService {
  private readonly records = new Map<string, FailedTransactionRecord>();

  enqueue(input: EnqueueFailedTransactionInput): FailedTransactionRecord {
    const now = new Date();
    const record: FailedTransactionRecord = {
      id: randomUUID(),
      operation: input.operation,
      escrowId: input.escrowId ?? null,
      errorMessage: input.errorMessage,
      ledgerFeedback: input.ledgerFeedback ?? null,
      attempts: input.attempts ?? 1,
      status: 'PENDING_REVIEW',
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      replayedAt: null,
      lastReplayTxHash: null,
    };
    this.records.set(record.id, record);
    return { ...record };
  }

  list(query: ListFailedTransactionsQuery = {}): FailedTransactionRecord[] {
    return [...this.records.values()]
      .filter((r) => (query.status ? r.status === query.status : true))
      .filter((r) => (query.operation ? r.operation === query.operation : true))
      .filter((r) => (query.escrowId ? r.escrowId === query.escrowId : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  get(id: string): FailedTransactionRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new NotFoundException(`Failed transaction ${id} not found`);
    }
    return { ...record };
  }

  /**
   * Re-execute the original operation via `replay`. On success the record is
   * marked `REPLAYED` and the new tx hash is stored; on failure the attempts
   * counter is bumped and the record stays `PENDING_REVIEW` for further review.
   */
  async replay(id: string, replay: ReplayFn): Promise<FailedTransactionRecord> {
    const record = this.requireRecord(id);
    if (record.status !== 'PENDING_REVIEW') {
      throw new Error(`Failed transaction ${id} is not pending review`);
    }

    let txHash: string;
    try {
      txHash = await replay({ ...record });
    } catch (err) {
      record.attempts += 1;
      record.errorMessage = err instanceof Error ? err.message : String(err);
      record.updatedAt = new Date();
      this.records.set(record.id, record);
      throw err;
    }

    record.status = 'REPLAYED';
    record.replayedAt = new Date();
    record.updatedAt = record.replayedAt;
    record.lastReplayTxHash = txHash;
    this.records.set(record.id, record);
    return { ...record };
  }

  abandon(id: string): FailedTransactionRecord {
    const record = this.requireRecord(id);
    record.status = 'ABANDONED';
    record.reviewedAt = new Date();
    record.updatedAt = record.reviewedAt;
    this.records.set(record.id, record);
    return { ...record };
  }

  markReviewed(id: string): FailedTransactionRecord {
    const record = this.requireRecord(id);
    record.reviewedAt = new Date();
    record.updatedAt = record.reviewedAt;
    this.records.set(record.id, record);
    return { ...record };
  }

  /** Internal helper that returns the live map entry (no clone). */
  private requireRecord(id: string): FailedTransactionRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new NotFoundException(`Failed transaction ${id} not found`);
    }
    return record;
  }
}
