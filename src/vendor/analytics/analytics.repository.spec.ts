import { AnalyticsRepository } from './analytics.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureVendors } from '../../../test/prisma-helpers';

describe('AnalyticsRepository', () => {
  let repository: AnalyticsRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    await ensureVendors(prisma, 'GVENDOR_ANALYTICS_1', 'GVENDOR_ANALYTICS_2');
    repository = new AnalyticsRepository(prisma);
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  describe('aggregateDailyVolume', () => {
    it('aggregates daily volume data with raw SQL', async () => {
      const vendorAddress = 'GVENDOR_ANALYTICS_1';
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      const endDate = new Date();

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 1',
          itemRef: 'ref-repo-1',
          amount: 150,
          currency: 'USD',
          buyerAddress: 'GBUYER_1',
          state: 'COMPLETED',
        },
      });

      const rows = await repository.aggregateDailyVolume(
        vendorAddress,
        startDate,
        endDate,
        'UTC',
      );

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(Number(rows[0].totalVolume)).toBe(150);
      expect(Number(rows[0].transactionCount)).toBe(1);
      expect(Number(rows[0].completedCount)).toBe(1);
      expect(Number(rows[0].disputedCount)).toBe(0);
    });
  });

  describe('getEscrowStateGroups', () => {
    it('groups escrows by state for the specified vendor', async () => {
      const vendorAddress = 'GVENDOR_ANALYTICS_1';

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 1',
          itemRef: 'ref-repo-state-1',
          amount: 200,
          currency: 'USD',
          buyerAddress: 'GBUYER_1',
          state: 'FUNDED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 2',
          itemRef: 'ref-repo-state-2',
          amount: 300,
          currency: 'USD',
          buyerAddress: 'GBUYER_2',
          state: 'FUNDED',
        },
      });

      const groups = await repository.getEscrowStateGroups(vendorAddress);

      expect(groups).toHaveLength(1);
      expect(groups[0].state).toBe('FUNDED');
      expect(Number(groups[0]._count)).toBe(2);
      expect(Number(groups[0]._sum?.amount)).toBe(500);
    });
  });

  describe('findNotificationChannels', () => {
    it('returns null when vendor has no tracking settings', async () => {
      const channels =
        await repository.findNotificationChannels('GVENDOR_ANALYTICS_1');
      expect(channels).toBeNull();
    });

    it('returns configured notification channels when settings exist', async () => {
      const vendorAddress = 'GVENDOR_ANALYTICS_2';
      await prisma.vendorTrackingSettings.create({
        data: {
          vendorAddress,
          notificationChannels: ['EMAIL', 'SMS'],
        },
      });

      const channels = await repository.findNotificationChannels(vendorAddress);
      expect(channels).toEqual(['EMAIL', 'SMS']);
    });
  });
});
