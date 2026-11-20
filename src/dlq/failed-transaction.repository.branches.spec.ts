/**
 * Tests for FailedTransactionRepository fallback branches (issue #1126).
 *
 * Covers: claimForReplay (with/without staleBefore), markAbandoned (count=0 → null).
 */

import { FailedTransactionRepository } from './failed-transaction.repository';
import { PrismaService } from '../prisma/prisma.service';

function makeRow() {
  return {
    id: 'ft-1',
    operation: 'submit',
    escrowId: null,
    errorMessage: 'err',
    ledgerFeedback: null,
    attempts: 1,
    status: 'PENDING_REVIEW',
    lastReplayTxHash: null,
    replayedAt: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('FailedTransactionRepository.claimForReplay', () => {
  it('claims without staleBefore (simple PENDING_REVIEW only)', async () => {
    const row = makeRow();
    const prisma = {
      failedTransaction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(row),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new FailedTransactionRepository(prisma);

    const result = await repo.claimForReplay('ft-1');
    expect(result).not.toBeNull();
  });

  it('includes stale REPLAYING in the OR clause when staleBefore is provided', async () => {
    const row = { ...makeRow(), status: 'REPLAYING' };
    const prisma = {
      failedTransaction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(row),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new FailedTransactionRepository(prisma);

    const result = await repo.claimForReplay('ft-1', new Date());
    expect(result).not.toBeNull();
    const whereArg = (prisma.failedTransaction.updateMany as jest.Mock).mock
      .calls[0][0].where;
    expect(whereArg.OR).toHaveLength(2);
  });

  it('returns null when no rows were updated', async () => {
    const prisma = {
      failedTransaction: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new FailedTransactionRepository(prisma);

    const result = await repo.claimForReplay('ft-1');
    expect(result).toBeNull();
  });
});

describe('FailedTransactionRepository.markAbandoned', () => {
  it('returns null when no rows matched', async () => {
    const prisma = {
      failedTransaction: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new FailedTransactionRepository(prisma);

    const result = await repo.markAbandoned('ft-1');
    expect(result).toBeNull();
  });

  it('includes stale REPLAYING condition when staleBefore is provided', async () => {
    const row = makeRow();
    const prisma = {
      failedTransaction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(row),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new FailedTransactionRepository(prisma);

    await repo.markAbandoned('ft-1', new Date());
    const whereArg = (prisma.failedTransaction.updateMany as jest.Mock).mock
      .calls[0][0].where;
    expect(whereArg.OR).toHaveLength(2);
  });
});
