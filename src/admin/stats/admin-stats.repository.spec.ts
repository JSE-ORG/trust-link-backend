import { AdminStatsRepository } from './admin-stats.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureVendors } from '../../../test/prisma-helpers';
import { DisputeStatusEnum } from '../../common/enums/escrow-state.enum';
import { EscrowState } from '@prisma/client';

const OPEN_DISPUTE_STATUSES: readonly string[] = [
  DisputeStatusEnum.OPEN,
  DisputeStatusEnum.UNDER_REVIEW,
];

describe('AdminStatsRepository', () => {
  let repo: AdminStatsRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    // Escrow.vendorAddress is a foreign key onto VendorProfile.address (#475).
    await ensureVendors(prisma, 'GVENDOR1', 'GVENDOR2', 'GBUYER1');
    repo = new AdminStatsRepository(prisma);
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool; leaving them
    // open across ~100 suites exhausts Postgres.
    await prisma?.$disconnect();
  });

  const createEscrow = (
    overrides: Partial<{
      itemRef: string;
      amount: number;
      state: EscrowState;
      vendorAddress: string;
      buyerAddress: string;
    }> = {},
  ) =>
    prisma.escrow.create({
      data: {
        itemName: 'item',
        itemRef: overrides.itemRef ?? 'ref-1',
        amount: overrides.amount ?? 100,
        currency: 'USDC',
        state: overrides.state ?? 'FUNDED',
        vendorAddress: overrides.vendorAddress ?? 'GVENDOR1',
        buyerAddress: overrides.buyerAddress ?? 'GBUYER1',
      },
    });

  describe('collectTotals()', () => {
    it('returns zeroes for an empty database', async () => {
      const totals = await repo.collectTotals();

      expect(totals.totalVolume).toBe(0);
      expect(totals.stateGroups).toEqual([]);
      expect(totals.uniqueVendors).toBe(0);
      expect(totals.uniqueBuyers).toBe(0);
    });

    it('sums escrow amounts into totalVolume', async () => {
      await createEscrow({ itemRef: 'ref-a', amount: 250.5 });
      await createEscrow({ itemRef: 'ref-b', amount: 100 });

      const totals = await repo.collectTotals();

      expect(totals.totalVolume).toBeCloseTo(350.5, 6);
    });

    it('groups escrows by state with their counts', async () => {
      await createEscrow({ itemRef: 'ref-a', state: 'FUNDED' });
      await createEscrow({ itemRef: 'ref-b', state: 'FUNDED' });
      await createEscrow({ itemRef: 'ref-c', state: 'COMPLETED' });

      const totals = await repo.collectTotals();
      const byState = Object.fromEntries(
        totals.stateGroups.map((g) => [g.state, g._count]),
      );

      expect(byState).toEqual({ FUNDED: 2, COMPLETED: 1 });
    });

    it('counts distinct vendors and buyers, not rows', async () => {
      await createEscrow({ itemRef: 'ref-a', vendorAddress: 'GVENDOR1' });
      await createEscrow({ itemRef: 'ref-b', vendorAddress: 'GVENDOR1' });
      await createEscrow({
        itemRef: 'ref-c',
        vendorAddress: 'GVENDOR2',
        buyerAddress: 'GBUYER1',
      });

      const totals = await repo.collectTotals();

      // Two escrow rows from GVENDOR1 must not read as two vendors.
      expect(totals.uniqueVendors).toBe(2);
      expect(totals.uniqueBuyers).toBe(1);
    });
  });

  describe('dispute counts', () => {
    // Dispute.escrowId is unique, so each dispute needs its own escrow.
    const createDispute = async (status: string, itemRef: string) => {
      const escrow = await createEscrow({ itemRef });
      return prisma.dispute.create({
        data: {
          escrowId: escrow.id,
          reason: 'Item not received',
          status,
        },
      });
    };

    it('counts every dispute', async () => {
      await createDispute(DisputeStatusEnum.OPEN, 'ref-open');
      await createDispute(DisputeStatusEnum.RESOLVED, 'ref-resolved');

      expect(await repo.countDisputes()).toBe(2);
    });

    it('counts only OPEN and UNDER_REVIEW as open', async () => {
      await createDispute(DisputeStatusEnum.OPEN, 'ref-open');
      await createDispute(DisputeStatusEnum.UNDER_REVIEW, 'ref-review');
      await createDispute(DisputeStatusEnum.RESOLVED, 'ref-resolved');
      await createDispute(DisputeStatusEnum.CANCELLED, 'ref-cancelled');

      const open = await repo.countOpenDisputes(OPEN_DISPUTE_STATUSES);

      expect(open).toBe(2);
    });
  });
});
