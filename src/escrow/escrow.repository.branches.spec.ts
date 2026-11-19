/**
 * Tests for EscrowRepository fallback branches (issue #1126).
 *
 * Covers: findById cache-hit/miss/null fallback paths.
 */

import { EscrowRepository } from './escrow.repository';
import { PrismaService, EscrowRecord, toEscrowRecord } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

function makeRow(overrides: Partial<EscrowRecord> = {}) {
  return {
    id: 'e-1',
    contractEscrowId: null,
    itemName: 'Item',
    itemRef: 'REF',
    amount: 10,
    currency: 'USDC',
    buyerAddress: 'B',
    vendorAddress: 'V',
    state: 'CREATED',
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    trackingCheckedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('EscrowRepository.findById', () => {
  it('returns revived cached record on cache hit', async () => {
    const cached = { ...makeRow(), shippedAt: '2024-01-01T00:00:00.000Z' };
    const cache = { get: jest.fn().mockResolvedValue(cached), set: jest.fn(), del: jest.fn() } as unknown as jest.Mocked<CacheService>;
    const prisma = { escrow: { findUnique: jest.fn() } } as unknown as jest.Mocked<PrismaService>;
    const repo = new EscrowRepository(prisma, cache);

    const result = await repo.findById('e-1');

    expect(result).not.toBeNull();
    expect(prisma.escrow.findUnique).not.toHaveBeenCalled();
  });

  it('falls through to DB on cache miss and sets cache', async () => {
    const row = makeRow();
    const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), del: jest.fn() } as unknown as jest.Mocked<CacheService>;
    const prisma = { escrow: { findUnique: jest.fn().mockResolvedValue(row) } } as unknown as jest.Mocked<PrismaService>;
    const repo = new EscrowRepository(prisma, cache);

    const result = await repo.findById('e-1');

    expect(result).not.toBeNull();
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it('returns null when DB row is absent', async () => {
    const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() } as unknown as jest.Mocked<CacheService>;
    const prisma = { escrow: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as jest.Mocked<PrismaService>;
    const repo = new EscrowRepository(prisma, cache);

    const result = await repo.findById('missing');
    expect(result).toBeNull();
    expect(cache.set).not.toHaveBeenCalled();
  });
});
