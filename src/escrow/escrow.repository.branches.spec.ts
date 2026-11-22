/**
 * Tests for EscrowRepository fallback branches (issue #1126).
 *
 * Covers: findById cache-hit/miss/null fallback paths.
 */

import { EscrowRepository, reviveCachedEscrow } from './escrow.repository';
import { PrismaService, EscrowRecord } from '../prisma/prisma.service';
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
    const cache = {
      get: jest.fn().mockResolvedValue(cached),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<CacheService>;
    const prisma = {
      escrow: { findUnique: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new EscrowRepository(prisma, cache);

    const result = await repo.findById('e-1');

    expect(result).not.toBeNull();
    expect(prisma.escrow.findUnique).not.toHaveBeenCalled();
  });

  it('falls through to DB on cache miss and sets cache', async () => {
    const row = makeRow();
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn(),
    } as unknown as jest.Mocked<CacheService>;
    const prisma = {
      escrow: { findUnique: jest.fn().mockResolvedValue(row) },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new EscrowRepository(prisma, cache);

    const result = await repo.findById('e-1');

    expect(result).not.toBeNull();
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it('returns null when DB row is absent', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<CacheService>;
    const prisma = {
      escrow: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new EscrowRepository(prisma, cache);

    const result = await repo.findById('missing');
    expect(result).toBeNull();
    expect(cache.set).not.toHaveBeenCalled();
  });
});

describe('reviveCachedEscrow', () => {
  it('revives string contractEscrowId to BigInt', () => {
    const cached = {
      ...makeRow(),
      contractEscrowId: '42',
    } as unknown as EscrowRecord;

    const revived = reviveCachedEscrow(cached);

    expect(revived.contractEscrowId).toBe(42n);
  });
});

describe('EscrowRepository.findEscrows filter branches', () => {
  function makeRepoWithMocks() {
    const prisma = {
      escrow: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as jest.Mocked<PrismaService>;
    return { prisma, repo: new EscrowRepository(prisma) };
  }

  it('uses exclusive next-day lt bound when to is a date-only YYYY-MM-DD string', async () => {
    const { prisma, repo } = makeRepoWithMocks();

    await repo.findEscrows(
      { from: '2024-03-01', to: '2024-03-15' },
      'date',
      'desc',
      1,
      20,
    );

    expect(prisma.escrow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date('2024-03-01'),
            lt: new Date('2024-03-16T00:00:00.000Z'),
          },
        }),
      }),
    );
  });

  it('uses inclusive lte bound when to includes a timestamp', async () => {
    const { prisma, repo } = makeRepoWithMocks();

    await repo.findEscrows(
      { to: '2024-03-15T12:30:00.000Z' },
      'amount',
      'asc',
      1,
      20,
    );

    expect(prisma.escrow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            lte: new Date('2024-03-15T12:30:00.000Z'),
          },
        }),
      }),
    );
  });

  it('builds scalar state filter when state is a single string', async () => {
    const { prisma, repo } = makeRepoWithMocks();

    await repo.findEscrows({ state: 'FUNDED' }, 'date', 'desc', 1, 20);

    expect(prisma.escrow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: 'FUNDED' }),
      }),
    );
  });

  it('builds { in } state filter when state is an array', async () => {
    const { prisma, repo } = makeRepoWithMocks();

    await repo.findEscrows(
      { state: ['FUNDED', 'SHIPPED'] },
      'date',
      'desc',
      1,
      20,
    );

    expect(prisma.escrow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: { in: ['FUNDED', 'SHIPPED'] },
        }),
      }),
    );
  });
});

describe('EscrowRepository.markTrackingChecked', () => {
  it('defaults checkedAt to current Date when omitted', async () => {
    const row = makeRow({ trackingCheckedAt: new Date() });
    const prisma = {
      escrow: { update: jest.fn().mockResolvedValue(row) },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new EscrowRepository(prisma);

    await repo.markTrackingChecked('e-1');

    expect(prisma.escrow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e-1' },
        data: { trackingCheckedAt: expect.any(Date) },
      }),
    );
  });
});

describe('EscrowRepository.findContractEscrowId', () => {
  it('returns the bigint contractEscrowId when found', async () => {
    const prisma = {
      escrow: {
        findUnique: jest.fn().mockResolvedValue({ contractEscrowId: 99n }),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new EscrowRepository(prisma);

    await expect(repo.findContractEscrowId('e-1')).resolves.toBe(99n);
    expect(prisma.escrow.findUnique).toHaveBeenCalledWith({
      where: { id: 'e-1' },
      select: { contractEscrowId: true },
    });
  });

  it('returns null when row is missing or has null contractEscrowId', async () => {
    const prisma = {
      escrow: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ contractEscrowId: null }),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new EscrowRepository(prisma);

    await expect(repo.findContractEscrowId('missing')).resolves.toBeNull();
    await expect(repo.findContractEscrowId('unmapped')).resolves.toBeNull();
  });
});
