export type FailedTransactionStatus =
  | 'PENDING_REVIEW'
  | 'REPLAYED'
  | 'ABANDONED';

/**
 * Captured failure of a Stellar contract submission queued for admin review or
 * re-execution (#74).
 *
 * `ledgerFeedback` is intentionally a free-form bag so callers can preserve the
 * full Horizon/Soroban response (resultXdr, opResultCodes, diagnosticEvents,
 * etc.) without forcing a schema migration each time a new field is captured.
 */
export interface FailedTransactionRecord {
  id: string;
  operation: string;
  escrowId: string | null;
  errorMessage: string;
  ledgerFeedback: Record<string, unknown> | null;
  attempts: number;
  status: FailedTransactionStatus;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  replayedAt: Date | null;
  lastReplayTxHash: string | null;
}

export interface EnqueueFailedTransactionInput {
  operation: string;
  escrowId?: string | null;
  errorMessage: string;
  ledgerFeedback?: Record<string, unknown> | null;
  attempts?: number;
}

export interface ListFailedTransactionsQuery {
  status?: FailedTransactionStatus;
  operation?: string;
  escrowId?: string;
}

/**
 * Callable that re-executes the original operation. Returns the new tx hash on
 * success; throwing surfaces as a replay failure that bumps `attempts` and
 * keeps the record `PENDING_REVIEW`.
 */
export type ReplayFn = (
  record: FailedTransactionRecord,
) => Promise<string>;
