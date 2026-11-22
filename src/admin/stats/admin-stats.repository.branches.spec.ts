/**
 * Tests for AdminStatsRepository fallback branches (issue #1126).
 *
 * Covers: collectTotals with zero rows (all aggregates default to 0).
 */

import { AdminStatsRepository } from './admin-stats.repository';
import { PrismaService } from '../../prisma/prisma.service';

describe('AdminStatsRepository.collectTotals', () => {
  it('returns zeros when there are no escrow rows', async () => {
    const prisma = {
      escrow: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ count: 0n }]),
    } as unknown as jest.Mocked<PrismaService>;

    // $queryRaw is called twice (vendors, buyers) — make both return 0
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([{ count: 0n }])
      .mockResolvedValueOnce([{ count: 0n }]);

    const repo = new AdminStatsRepository(prisma);
    const totals = await repo.collectTotals();

    expect(totals.totalVolume).toBe(0);
    expect(totals.stateGroups).toHaveLength(0);
    expect(totals.uniqueVendors).toBe(0);
    expect(totals.uniqueBuyers).toBe(0);
  });

  it('converts BigInt count rows to numbers', async () => {
    const prisma = {
      escrow: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 100 } }),
        groupBy: jest.fn().mockResolvedValue([{ state: 'FUNDED', _count: 2 }]),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ count: 3n }])
        .mockResolvedValueOnce([{ count: 5n }]),
    } as unknown as jest.Mocked<PrismaService>;

    const repo = new AdminStatsRepository(prisma);
    const totals = await repo.collectTotals();

    expect(totals.totalVolume).toBe(100);
    expect(totals.uniqueVendors).toBe(3);
    expect(totals.uniqueBuyers).toBe(5);
  });

  it('treats empty COUNT(DISTINCT) result rows as zero unique vendors and buyers (issue #1227)', async () => {
    const prisma = {
      escrow: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 10 } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
    } as unknown as jest.Mocked<PrismaService>;

    const totals = await new AdminStatsRepository(prisma).collectTotals();

    expect(totals.uniqueVendors).toBe(0);
    expect(totals.uniqueBuyers).toBe(0);
  });

  it('treats a row with a null count as zero', async () => {
    const prisma = {
      escrow: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ count: null }])
        .mockResolvedValueOnce([{ count: 4n }]),
    } as unknown as jest.Mocked<PrismaService>;

    const totals = await new AdminStatsRepository(prisma).collectTotals();

    expect(totals.uniqueVendors).toBe(0);
    expect(totals.uniqueBuyers).toBe(4);
  });
});
