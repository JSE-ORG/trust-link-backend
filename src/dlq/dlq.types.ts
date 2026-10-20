import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type FailedTransactionStatus =
  'PENDING_REVIEW' | 'REPLAYED' | 'ABANDONED';

/**
 * Captured failure of a Stellar contract submission queued for admin review or
 * re-execution (#74).
 *
 * `ledgerFeedback` is intentionally a free-form bag so callers can preserve the
 * full Horizon/Soroban response (resultXdr, opResultCodes, diagnosticEvents,
 * etc.) without forcing a schema migration each time a new field is captured.
 */
export class FailedTransactionRecord {
  @ApiProperty({
    description: 'Unique identifier for the failed transaction record.',
    format: 'uuid',
    example: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  })
  id!: string;

  @ApiProperty({
    description: 'Name of the contract operation that failed.',
    example: 'submitAutoRelease',
  })
  operation!: string;

  @ApiPropertyOptional({
    description: 'Identifier of the associated escrow, if applicable.',
    nullable: true,
    format: 'uuid',
    example: '9d9e2e16-0c78-4a84-9c8c-0f3a5eb2d4e3',
  })
  escrowId!: string | null;

  @ApiProperty({
    description:
      'Error message captured during contract execution or submission.',
    example: 'Transaction simulation failed with error code -3',
  })
  errorMessage!: string;

  @ApiPropertyOptional({
    description:
      'Raw ledger/contract diagnostic feedback captured from Horizon/Soroban.',
    nullable: true,
    additionalProperties: true,
    example: { opResultCodes: ['op_success'], diagnosticEvents: [] },
  })
  ledgerFeedback!: Record<string, unknown> | null;

  @ApiProperty({
    description:
      'Number of replay/execution attempts made for this transaction.',
    example: 1,
  })
  attempts!: number;

  @ApiProperty({
    description: 'Current status of the failed transaction review.',
    enum: ['PENDING_REVIEW', 'REPLAYED', 'ABANDONED'],
    example: 'PENDING_REVIEW',
  })
  status!: FailedTransactionStatus;

  @ApiProperty({
    description: 'ISO-8601 timestamp when this failure was recorded.',
    type: String,
    format: 'date-time',
    example: '2026-05-27T10:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'ISO-8601 timestamp when this record was last modified.',
    type: String,
    format: 'date-time',
    example: '2026-05-27T10:05:00.000Z',
  })
  updatedAt!: Date;

  @ApiPropertyOptional({
    description:
      'ISO-8601 timestamp when this failure was reviewed by an admin.',
    nullable: true,
    type: String,
    format: 'date-time',
    example: null,
  })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({
    description:
      'ISO-8601 timestamp when this transaction was successfully replayed.',
    nullable: true,
    type: String,
    format: 'date-time',
    example: null,
  })
  replayedAt!: Date | null;

  @ApiPropertyOptional({
    description:
      'Stellar transaction hash of the successful replay, if replayed.',
    nullable: true,
    example: null,
  })
  lastReplayTxHash!: string | null;
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
  page?: number;
  limit?: number;
}

export class PaginatedFailedTransactions {
  @ApiProperty({
    description: 'List of failed transaction records for the current page.',
    type: [FailedTransactionRecord],
  })
  data!: FailedTransactionRecord[];

  @ApiProperty({
    description: 'Total number of failed transactions matching the filter.',
    example: 12,
  })
  total!: number;

  @ApiProperty({
    description: '1-based page number.',
    example: 1,
    minimum: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Maximum number of records returned per page.',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  limit!: number;
}

/**
 * Callable that re-executes the original operation. Returns the new tx hash on
 * success; throwing surfaces as a replay failure that bumps `attempts` and
 * keeps the record `PENDING_REVIEW`.
 */
export type ReplayFn = (record: FailedTransactionRecord) => Promise<string>;
