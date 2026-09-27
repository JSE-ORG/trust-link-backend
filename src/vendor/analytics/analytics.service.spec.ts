import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { EscrowState, PrismaService } from '../../prisma/prisma.service';
import { ensureVendors } from '../../../test/prisma-helpers';
import { DailyVolumeDataDto } from './analytics.dto';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: PrismaService,
          useValue: new PrismaService(),
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    prisma = module.get<PrismaService>(PrismaService);

    // Reset prisma before each test
    await prisma.reset();
    // Every vendor address used anywhere in this file. Escrow.vendorAddress and
    // VendorTrackingSettings.vendorAddress are foreign keys onto
    // VendorProfile.address, so the parent rows must exist first (#475). Only
    // four were seeded previously, which the in-memory store did not mind.
    await ensureVendors(
      prisma,
      '0xVendor123',
      '0xVendor456',
      '0xVendorABC',
      '0xVendorActive',
      '0xVendorBoth',
      '0xVendorCompleted',
      '0xVendorEmail',
      '0xVendorMixed',
      '0xVendorNoSettings',
      '0xVendorSMS',
      '0xVendorTZ',
      '0xVendorWithCancelled',
      '0xVendorXYZ',
      '0xVendorA',
      '0xVendorB',
      '0xStatsVendorA',
      '0xStatsVendorB',
      '0xVendorDefaults',
    );
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool. Constructed in
    // beforeEach across ~100 suites, undisconnected clients exhaust Postgres
    // (`sorry, too many clients already`) partway through a full run.
    await prisma?.$disconnect();
  });

  // ─── getDailyVolumeChart ───────────────────────────────────────────────────

  describe('getDailyVolumeChart', () => {
    it('should aggregate transactions by date using database-level query', async () => {
      const vendorAddress = '0xVendor123';
      const days = 7;

      // Create test escrows across multiple days (base = 4 days ago so all fit in the 7-day window)
      const baseDate = new Date();
      baseDate.setDate(baseDate.getDate() - 4);

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 1',
          itemRef: 'ref-1',
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyer1',
          state: 'COMPLETED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 2',
          itemRef: 'ref-2',
          amount: 200,
          currency: 'USD',
          buyerAddress: '0xBuyer2',
          state: 'COMPLETED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 3',
          itemRef: 'ref-3',
          amount: 150,
          currency: 'USD',
          buyerAddress: '0xBuyer3',
          state: 'DISPUTED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 4',
          itemRef: 'ref-4',
          amount: 300,
          currency: 'USD',
          buyerAddress: '0xBuyer4',
          state: 'COMPLETED',
        },
      });

      const result = await service.getDailyVolumeChart(
        vendorAddress,
        days,
        'UTC',
      );

      expect(result.data).toBeDefined();
      expect(result.data.length).toBe(7);
      expect(result.summary.totalVolume).toBe(750);
      expect(result.summary.totalTransactions).toBe(4);
    });

    it('should fill gaps for days with zero transactions', async () => {
      const vendorAddress = '0xVendor456';
      const days = 5;

      // Create escrow only on day 1 and day 3
      const baseDate = new Date();
      baseDate.setDate(baseDate.getDate() - 4);

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 1',
          itemRef: 'ref-5',
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyer1',
          state: 'COMPLETED',
          createdAt: baseDate,
        },
      });

      const day3Date = new Date(baseDate);
      day3Date.setDate(day3Date.getDate() + 2);

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 1',
          itemRef: 'ref-6',
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyer1',
          state: 'COMPLETED',
          createdAt: day3Date,
        },
      });

      const result = await service.getDailyVolumeChart(
        vendorAddress,
        days,
        'UTC',
      );

      // Should have entries for all 5 days
      expect(result.data.length).toBe(5);

      // Check that days with no transactions have zero values
      const zeroDays = result.data.filter((d) => d.transactionCount === 0);
      expect(zeroDays.length).toBe(3);
    });

    it('should return empty result for vendor with no transactions', async () => {
      const vendorAddress = '0xVendorXYZ';
      const days = 7;

      const result = await service.getDailyVolumeChart(
        vendorAddress,
        days,
        'UTC',
      );

      expect(result.data.length).toBe(7);
      expect(result.summary.totalVolume).toBe(0);
      expect(result.summary.totalTransactions).toBe(0);
      expect(result.summary.averageDaily).toBe(0);
    });

    it('uses default days=30 and timezone=UTC when called with vendor address only', async () => {
      // Calling with no optional args exercises the default-arg branches.
      // With no escrows the summary must be zeroed and the data array must
      // contain exactly 30 daily entries (today minus 29 days → today).
      const result = await service.getDailyVolumeChart('0xVendorDefaults');

      expect(result.data.length).toBe(30);
      expect(result.summary.totalVolume).toBe(0);
      expect(result.summary.totalTransactions).toBe(0);
      expect(result.summary.averageDaily).toBe(0);

      // Every entry should be a zero-filled day
      for (const day of result.data) {
        expect(day.transactionCount).toBe(0);
        expect(day.totalVolume).toBe(0);
        expect(day.completedCount).toBe(0);
        expect(day.disputedCount).toBe(0);
        expect(day.averageTransactionValue).toBe(0);
      }
    });

    it('should calculate correct aggregations', async () => {
      const vendorAddress = '0xVendorABC';
      const days = 3;

      // Create multiple escrows with different states
      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 1',
          itemRef: 'ref-7',
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyer1',
          state: 'COMPLETED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 2',
          itemRef: 'ref-8',
          amount: 200,
          currency: 'USD',
          buyerAddress: '0xBuyer2',
          state: 'RELEASED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 3',
          itemRef: 'ref-9',
          amount: 150,
          currency: 'USD',
          buyerAddress: '0xBuyer3',
          state: 'DISPUTED',
        },
      });

      const result = await service.getDailyVolumeChart(
        vendorAddress,
        days,
        'UTC',
      );

      const dayData = result.data.find((d) => d.transactionCount > 0)!;
      expect(dayData).toBeDefined();
      expect(dayData.totalVolume).toBe(450);
      expect(dayData.transactionCount).toBe(3);
      expect(dayData.completedCount).toBe(2); // COMPLETED + RELEASED
      expect(dayData.disputedCount).toBe(1);
      expect(dayData.averageTransactionValue).toBe(150);
    });

    it('attributes an escrow to the correct UTC date when created just after midnight UTC', async () => {
      /**
       * Timezone boundary test.
       *
       * An escrow created at 00:30 UTC is still "today" in UTC, but in any
       * timezone west of UTC it belongs to "yesterday".  We pin the escrow
       * to 00:30 UTC exactly 30 days ago so it always falls inside the
       * rolling 60-day window the service uses.
       *
       * Example (UTC-5 / America/New_York in winter / EST):
       *   00:30 UTC on day D  →  19:30 on day D-1 in New York
       *
       * UTC result  → the escrow lands on dateUTC  (today-30 in UTC)
       * NY  result  → the escrow lands on dateNY   (today-31 in NY)
       */
      const vendorAddress = '0xVendorTZ';

      // Construct a timestamp: 00:30 UTC, exactly 30 days ago.
      const now = new Date();
      const midnightCrosser = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 30,
          0, // hour
          30, // minute — 00:30 UTC is the previous calendar day for UTC-5
          0,
        ),
      );

      // Derive the expected date strings from the pinned timestamp.
      const dateUTC = midnightCrosser.toLocaleDateString('en-CA', {
        timeZone: 'UTC',
      });
      const dateNY = midnightCrosser.toLocaleDateString('en-CA', {
        timeZone: 'America/New_York',
      });

      // The two date strings must differ (UTC-5 crosses the day boundary).
      expect(dateUTC).not.toBe(dateNY);

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'TZ Test Item',
          itemRef: 'ref-10',
          amount: 500,
          currency: 'USD',
          buyerAddress: '0xBuyerTZ',
          state: 'COMPLETED',
          createdAt: midnightCrosser,
        },
      });

      // ── UTC view ───────────────────────────────────────────────────────────
      const utcResult = await service.getDailyVolumeChart(
        vendorAddress,
        60,
        'UTC',
      );
      const utcDay = utcResult.data.find((d) => d.date === dateUTC)!;
      expect(utcDay).toBeDefined();
      expect(utcDay.transactionCount).toBe(1);
      expect(utcDay.totalVolume).toBe(500);

      // The NY date should have zero transactions in the UTC view.
      const utcViewNYDate = utcResult.data.find((d) => d.date === dateNY);
      expect(utcViewNYDate?.transactionCount ?? 0).toBe(0);

      // ── America/New_York view ──────────────────────────────────────────────
      const nyResult = await service.getDailyVolumeChart(
        vendorAddress,
        60,
        'America/New_York',
      );
      const nyDay = nyResult.data.find((d) => d.date === dateNY)!;
      expect(nyDay).toBeDefined();
      expect(nyDay.transactionCount).toBe(1);
      expect(nyDay.totalVolume).toBe(500);

      // The UTC date should have zero transactions in the NY view.
      const nyViewUTCDate = nyResult.data.find((d) => d.date === dateUTC);
      expect(nyViewUTCDate?.transactionCount ?? 0).toBe(0);
    });

    it('vendor A totals do not include vendor B escrows (chart isolation)', async () => {
      const vendorA = '0xVendorA';
      const vendorB = '0xVendorB';

      await prisma.escrow.create({
        data: {
          vendorAddress: vendorA,
          itemName: 'A Item',
          itemRef: 'ref-11',
          amount: 300,
          currency: 'USD',
          buyerAddress: '0xBuyerA',
          state: 'COMPLETED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress: vendorB,
          itemName: 'B Item',
          itemRef: 'ref-12',
          amount: 9999,
          currency: 'USD',
          buyerAddress: '0xBuyerB',
          state: 'COMPLETED',
        },
      });

      const result = await service.getDailyVolumeChart(vendorA, 7, 'UTC');

      expect(result.summary.totalVolume).toBe(300);
      expect(result.summary.totalTransactions).toBe(1);
    });
  });

  // ─── getTransactionStats ──────────────────────────────────────────────────

  describe('getTransactionStats', () => {
    it('returns zeroed figures for a vendor with no escrows', async () => {
      const result = await service.getTransactionStats('0xNoEscrows');

      expect(result.stats.totalVolume).toBe(0);
      expect(result.stats.activeVolume).toBe(0);
      expect(result.stats.totalTransactions).toBe(0);
      expect(result.stats.activeTransactions).toBe(0);
      expect(result.stats.completedTransactions).toBe(0);
      expect(result.stats.completionRate).toBe(0);
      expect(result.stats.disputedTransactions).toBe(0);
      expect(result.stats.disputeRate).toBe(0);
      expect(result.stats.averageTransactionValue).toBe(0);
      expect(result.stats.cancelledTransactions).toBe(0);
    });

    it('counts active-state escrows correctly (CREATED, FUNDED, SHIPPED, DELIVERED)', async () => {
      const vendorAddress = '0xVendorActive';
      const activeStates = [
        'CREATED',
        'FUNDED',
        'SHIPPED',
        'DELIVERED',
      ] as const;

      for (const [i, state] of activeStates.entries()) {
        await prisma.escrow.create({
          data: {
            vendorAddress,
            itemName: `Item ${i}`,
            itemRef: `ref-${i}`,
            amount: 100,
            currency: 'USD',
            buyerAddress: `0xBuyer${i}`,
            state,
          },
        });
      }

      const result = await service.getTransactionStats(vendorAddress);

      expect(result.stats.totalTransactions).toBe(4);
      expect(result.stats.activeTransactions).toBe(4);
      expect(result.stats.activeVolume).toBe(400);
      expect(result.stats.completedTransactions).toBe(0);
      expect(result.stats.disputedTransactions).toBe(0);
      expect(result.stats.totalVolume).toBe(400);
    });

    it('counts COMPLETED and RELEASED as completedTransactions', async () => {
      const vendorAddress = '0xVendorCompleted';

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Completed Item',
          itemRef: 'ref-13',
          amount: 200,
          currency: 'USD',
          buyerAddress: '0xBuyer1',
          state: 'COMPLETED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Released Item',
          itemRef: 'ref-14',
          amount: 300,
          currency: 'USD',
          buyerAddress: '0xBuyer2',
          state: 'RELEASED',
        },
      });

      const result = await service.getTransactionStats(vendorAddress);

      expect(result.stats.completedTransactions).toBe(2);
      expect(result.stats.completionRate).toBe(100);
      expect(result.stats.totalVolume).toBe(500);
      expect(result.stats.averageTransactionValue).toBe(250);
    });

    it('computes exact completion rate and dispute rate across mixed states', async () => {
      /**
       * 10 escrows total:
       *   4 COMPLETED → completionRate = 4/10 * 100 = 40
       *   2 DISPUTED  → disputeRate    = 2/10 * 100 = 20
       *   4 FUNDED    → active
       */
      const vendorAddress = '0xVendorMixed';
      const scenarios: Array<{ state: EscrowState; amount: number }> = [
        { state: 'COMPLETED', amount: 100 },
        { state: 'COMPLETED', amount: 100 },
        { state: 'COMPLETED', amount: 100 },
        { state: 'COMPLETED', amount: 100 },
        { state: 'DISPUTED', amount: 50 },
        { state: 'DISPUTED', amount: 50 },
        { state: 'FUNDED', amount: 200 },
        { state: 'FUNDED', amount: 200 },
        { state: 'FUNDED', amount: 200 },
        { state: 'FUNDED', amount: 200 },
      ];

      for (const [i, { state, amount }] of scenarios.entries()) {
        await prisma.escrow.create({
          data: {
            vendorAddress,
            itemName: `Item ${i}`,
            itemRef: `ref-${i}`,
            amount,
            currency: 'USD',
            buyerAddress: `0xBuyer${i}`,
            state,
          },
        });
      }

      const result = await service.getTransactionStats(vendorAddress);

      expect(result.stats.totalTransactions).toBe(10);
      expect(result.stats.completedTransactions).toBe(4);
      expect(result.stats.disputedTransactions).toBe(2);
      expect(result.stats.activeTransactions).toBe(4);
      expect(result.stats.completionRate).toBe(40);
      expect(result.stats.disputeRate).toBe(20);
      expect(result.stats.totalVolume).toBe(1300);
      expect(result.stats.averageTransactionValue).toBe(130);
    });

    it('returns channel metrics as false when no tracking settings exist', async () => {
      await prisma.escrow.create({
        data: {
          vendorAddress: '0xVendorNoSettings',
          itemName: 'Item',
          itemRef: 'ref-15',
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyer',
          state: 'COMPLETED',
        },
      });

      const result = await service.getTransactionStats('0xVendorNoSettings');

      expect(result.channels.email.notificationsEnabled).toBe(false);
      expect(result.channels.sms.notificationsEnabled).toBe(false);
    });

    it('returns email=true when EMAIL is in tracking notificationChannels', async () => {
      const vendorAddress = '0xVendorEmail';

      await prisma.vendorTrackingSettings.upsert({
        where: { vendorAddress },
        create: { vendorAddress, notificationChannels: ['EMAIL'] },
        update: { notificationChannels: ['EMAIL'] },
      });

      const result = await service.getTransactionStats(vendorAddress);

      expect(result.channels.email.notificationsEnabled).toBe(true);
      expect(result.channels.sms.notificationsEnabled).toBe(false);
    });

    it('returns sms=true when SMS is in tracking notificationChannels', async () => {
      const vendorAddress = '0xVendorSMS';

      await prisma.vendorTrackingSettings.upsert({
        where: { vendorAddress },
        create: { vendorAddress, notificationChannels: ['SMS'] },
        update: { notificationChannels: ['SMS'] },
      });

      const result = await service.getTransactionStats(vendorAddress);

      expect(result.channels.email.notificationsEnabled).toBe(false);
      expect(result.channels.sms.notificationsEnabled).toBe(true);
    });

    it('returns email=true and sms=true when both channels are enabled', async () => {
      const vendorAddress = '0xVendorBoth';

      await prisma.vendorTrackingSettings.upsert({
        where: { vendorAddress },
        create: { vendorAddress, notificationChannels: ['EMAIL', 'SMS'] },
        update: { notificationChannels: ['EMAIL', 'SMS'] },
      });

      const result = await service.getTransactionStats(vendorAddress);

      expect(result.channels.email.notificationsEnabled).toBe(true);
      expect(result.channels.sms.notificationsEnabled).toBe(true);
    });

    it('vendor A totals do not include vendor B escrows (stats isolation)', async () => {
      const vendorA = '0xStatsVendorA';
      const vendorB = '0xStatsVendorB';

      // Vendor A: 2 escrows, total volume 600
      await prisma.escrow.create({
        data: {
          vendorAddress: vendorA,
          itemName: 'A1',
          itemRef: 'ref-16',
          amount: 250,
          currency: 'USD',
          buyerAddress: '0xBuyerA1',
          state: 'COMPLETED',
        },
      });
      await prisma.escrow.create({
        data: {
          vendorAddress: vendorA,
          itemName: 'A2',
          itemRef: 'ref-17',
          amount: 350,
          currency: 'USD',
          buyerAddress: '0xBuyerA2',
          state: 'FUNDED',
        },
      });

      // Vendor B: 1 escrow, volume 9000 (should never appear in A's stats)
      await prisma.escrow.create({
        data: {
          vendorAddress: vendorB,
          itemName: 'B1',
          itemRef: 'ref-18',
          amount: 9000,
          currency: 'USD',
          buyerAddress: '0xBuyerB1',
          state: 'COMPLETED',
        },
      });

      const resultA = await service.getTransactionStats(vendorA);

      expect(resultA.stats.totalTransactions).toBe(2);
      expect(resultA.stats.totalVolume).toBe(600);
      expect(resultA.stats.completedTransactions).toBe(1);
      expect(resultA.stats.activeTransactions).toBe(1);
      expect(resultA.stats.completionRate).toBe(50);
      expect(resultA.stats.averageTransactionValue).toBe(300);
    });

    it('includes a lastUpdated ISO timestamp in the response', async () => {
      const result = await service.getTransactionStats('0xTimestampCheck');
      expect(result.lastUpdated).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it('counts CANCELLED escrows in cancelledTransactions and totalTransactions', async () => {
      /**
       * A cancelled escrow is not active, completed, or disputed, but it
       * must still appear in totalTransactions, totalVolume, and
       * cancelledTransactions so vendor revenue figures are accurate.
       *
       * 3 escrows total:
       *   1 COMPLETED  → completedTransactions = 1
       *   1 CANCELLED  → cancelledTransactions = 1
       *   1 FUNDED     → activeTransactions    = 1
       *
       * completionRate = 1/3 * 100 ≈ 33.33...
       * disputeRate    = 0/3 * 100 = 0
       * totalVolume    = 100 + 50 + 200 = 350
       * averageValue   = 350 / 3 ≈ 116.67
       */
      const vendorAddress = '0xVendorWithCancelled';

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Completed Item',
          itemRef: 'ref-19',
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyerC1',
          state: 'COMPLETED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Cancelled Item',
          itemRef: 'ref-20',
          amount: 50,
          currency: 'USD',
          buyerAddress: '0xBuyerC2',
          state: 'CANCELLED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Funded Item',
          itemRef: 'ref-21',
          amount: 200,
          currency: 'USD',
          buyerAddress: '0xBuyerC3',
          state: 'FUNDED',
        },
      });

      const result = await service.getTransactionStats(vendorAddress);

      expect(result.stats.totalTransactions).toBe(3);
      expect(result.stats.cancelledTransactions).toBe(1);
      expect(result.stats.completedTransactions).toBe(1);
      expect(result.stats.activeTransactions).toBe(1);
      expect(result.stats.disputedTransactions).toBe(0);
      expect(result.stats.totalVolume).toBe(350);
      expect(result.stats.averageTransactionValue).toBeCloseTo(350 / 3, 5);
      expect(result.stats.completionRate).toBeCloseTo((1 / 3) * 100, 5);
      expect(result.stats.disputeRate).toBe(0);
    });
  });

  // ─── getDailyVolumeChart (UTC default + toDateKey Date branch) ───────────

  describe('getDailyVolumeChart — UTC timezone default', () => {
    it('groups escrows by UTC date when called without a timezone argument', async () => {
      const vendorAddress = '0xVendorDefaults';
      const now = new Date();
      // Pin the escrow to noon UTC yesterday so it is always within 30 days.
      const createdAt = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 1,
          12,
          0,
          0,
        ),
      );
      const expectedDate = createdAt.toISOString().slice(0, 10);

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'UTC Default Item',
          itemRef: 'ref-utc-default',
          amount: 250,
          currency: 'USD',
          buyerAddress: '0xBuyerUTC',
          state: 'COMPLETED',
          createdAt,
        },
      });

      // Call without timezone — exercises the `timezone: string = 'UTC'` default.
      const result = await service.getDailyVolumeChart(vendorAddress);

      expect(result.data.length).toBe(30);
      const day = result.data.find((d) => d.date === expectedDate);
      expect(day).toBeDefined();
      expect(day?.transactionCount).toBe(1);
      expect(day?.totalVolume).toBe(250);
    });
  });

  // ─── toDateKey ────────────────────────────────────────────────────────────

  describe('toDateKey (private)', () => {
    it('returns the ISO date slice when value is a Date instance', () => {
      const d = new Date('2024-03-15T14:30:00Z');
      expect(service['toDateKey'](d)).toBe('2024-03-15');
    });

    it('returns the ISO date slice when value is a plain string', () => {
      expect(service['toDateKey']('2024-07-20')).toBe('2024-07-20');
    });
  });

  // ─── fillDateGaps ──────────────────────────────────────────────────────────

  describe('fillDateGaps', () => {
    it('should fill missing dates with zero values', () => {
      const dailyMap = new Map<string, DailyVolumeDataDto>();
      dailyMap.set('2024-01-01', {
        date: '2024-01-01',
        totalVolume: 100,
        transactionCount: 1,
        completedCount: 1,
        disputedCount: 0,
        averageTransactionValue: 100,
      });

      dailyMap.set('2024-01-03', {
        date: '2024-01-03',
        totalVolume: 200,
        transactionCount: 2,
        completedCount: 2,
        disputedCount: 0,
        averageTransactionValue: 100,
      });

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-05');

      // Access private method using bracket notation
      const filledData = service['fillDateGaps'](
        dailyMap,
        startDate,
        endDate,
        'UTC',
      );

      expect(filledData.length).toBe(5);
      expect(filledData[0].date).toBe('2024-01-01');
      expect(filledData[0].totalVolume).toBe(100);
      expect(filledData[1].date).toBe('2024-01-02');
      expect(filledData[1].totalVolume).toBe(0);
      expect(filledData[2].date).toBe('2024-01-03');
      expect(filledData[2].totalVolume).toBe(200);
    });
  });

  // ─── formatDateInTimezone ─────────────────────────────────────────────────

  describe('formatDateInTimezone', () => {
    it('should format date correctly in UTC', () => {
      const date = new Date('2024-01-15T12:30:00Z');
      const formatted = service['formatDateInTimezone'](date, 'UTC');
      expect(formatted).toBe('2024-01-15');
    });

    it('attributes 2024-01-15T00:30Z to 2024-01-14 in America/New_York (UTC-5)', () => {
      // 00:30 UTC on Jan 15 is 19:30 on Jan 14 in New York (EST = UTC-5)
      const date = new Date('2024-01-15T00:30:00Z');
      const formatted = service['formatDateInTimezone'](
        date,
        'America/New_York',
      );
      expect(formatted).toBe('2024-01-14');
    });

    it('attributes 2024-01-14T23:30Z to 2024-01-15 in Asia/Tokyo (UTC+9)', () => {
      // 23:30 UTC on Jan 14 is 08:30 on Jan 15 in Tokyo (JST = UTC+9)
      const date = new Date('2024-01-14T23:30:00Z');
      const formatted = (
        service as unknown as {
          formatDateInTimezone: (d: Date, tz: string) => string;
        }
      ).formatDateInTimezone(date, 'Asia/Tokyo');
      expect(formatted).toBe('2024-01-15');
    });
  });
});

/**
 * Issue #843 — vendor stats were computed by loading every escrow and folding
 * the rows in JavaScript, converting each `Decimal(18, 8)` amount through
 * `Number()` first.
 *
 * These tests pin the two properties the fix is about: the aggregation happens
 * in the database, and the sums are exact.
 */
describe('AnalyticsService.getTransactionStats aggregation (#843)', () => {
  let service: AnalyticsService;
  let prisma: PrismaService;

  const VENDOR = '0xVendorAggregate';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: new PrismaService() },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    prisma = module.get<PrismaService>(PrismaService);

    await prisma.reset();
    await ensureVendors(prisma, VENDOR);
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  async function seed(
    state: EscrowState,
    amount: number | string,
    index: number,
  ): Promise<void> {
    await prisma.escrow.create({
      data: {
        vendorAddress: VENDOR,
        itemName: `Item ${index}`,
        itemRef: `ref-agg-${index}`,
        amount,
        currency: 'USD',
        buyerAddress: `0xBuyer${index}`,
        state,
      },
    });
  }

  it('aggregates with groupBy rather than loading every escrow row', async () => {
    const findManySpy = jest.spyOn(prisma.escrow, 'findMany');
    const groupBySpy = jest.spyOn(prisma.escrow, 'groupBy');

    await seed('FUNDED', 100, 1);
    await seed('COMPLETED', 200, 2);

    const result = await service.getTransactionStats(VENDOR);

    // The stats path must not pull the vendor's escrows into memory.
    expect(groupBySpy).toHaveBeenCalledTimes(1);
    expect(findManySpy).not.toHaveBeenCalled();
    expect(result.stats.totalTransactions).toBe(2);
  });

  it('groups by state and asks for both a count and an amount sum', async () => {
    const groupBySpy = jest.spyOn(prisma.escrow, 'groupBy');

    await service.getTransactionStats(VENDOR);

    const args = groupBySpy.mock.calls[0][0] as unknown as {
      by: string[];
      _count: unknown;
      _sum: Record<string, boolean>;
      where: Record<string, unknown>;
    };
    expect(args.by).toEqual(['state']);
    expect(args._count).toBe(true);
    expect(args._sum).toEqual({ amount: true });
    expect(args.where).toEqual({ vendorAddress: VENDOR });
  });

  it('keeps the response shape identical for a mixed set of states', async () => {
    await seed('CREATED', 10, 1);
    await seed('FUNDED', 20, 2);
    await seed('SHIPPED', 30, 3);
    await seed('DELIVERED', 40, 4);
    await seed('COMPLETED', 50, 5);
    await seed('RELEASED', 60, 6);
    await seed('DISPUTED', 70, 7);
    await seed('REFUNDED', 80, 8);
    await seed('CANCELLED', 90, 9);

    const { stats, channels, lastUpdated } = await service.getTransactionStats(
      VENDOR,
    );

    expect(stats.totalTransactions).toBe(9);
    expect(stats.totalVolume).toBe(450);
    // Active: CREATED + FUNDED + SHIPPED + DELIVERED
    expect(stats.activeTransactions).toBe(4);
    expect(stats.activeVolume).toBe(100);
    expect(stats.completedTransactions).toBe(2);
    expect(stats.disputedTransactions).toBe(1);
    expect(stats.cancelledTransactions).toBe(1);
    expect(stats.completionRate).toBeCloseTo((2 / 9) * 100, 10);
    expect(stats.disputeRate).toBeCloseTo((1 / 9) * 100, 10);
    expect(stats.averageTransactionValue).toBe(50);
    expect(channels).toEqual({
      email: { notificationsEnabled: false },
      sms: { notificationsEnabled: false },
    });
    expect(typeof lastUpdated).toBe('string');
    // Shape is exactly the DTO's fields, nothing added or dropped.
    expect(Object.keys(stats).sort()).toEqual(
      [
        'activeTransactions',
        'activeVolume',
        'averageTransactionValue',
        'cancelledTransactions',
        'completedTransactions',
        'completionRate',
        'disputedTransactions',
        'disputeRate',
        'totalTransactions',
        'totalVolume',
      ].sort(),
    );
  });

  // ── Decimal precision ───────────────────────────────────────────────────

  it('sums 8-decimal amounts exactly where float addition would drift', async () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. Each of these is an exact
    // Decimal(18, 8) value, so the exact total is 0.30000000.
    await seed('FUNDED', '0.1', 1);
    await seed('FUNDED', '0.2', 2);

    const { stats } = await service.getTransactionStats(VENDOR);

    expect(stats.totalVolume).toBe(0.3);
    // The naive float sum of the same two values.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('sums across many small amounts without accumulating float error', async () => {
    // 0.1 added 10 times: exact decimal total is 1.0, float total is not.
    for (let i = 0; i < 10; i++) {
      await seed('COMPLETED', '0.1', i);
    }

    const { stats } = await service.getTransactionStats(VENDOR);

    expect(stats.totalVolume).toBe(1);
    expect(stats.completedTransactions).toBe(10);
  });

  it('preserves 8 decimal places on the total', async () => {
    await seed('FUNDED', '0.00000001', 1);
    await seed('FUNDED', '0.00000002', 2);

    const { stats } = await service.getTransactionStats(VENDOR);

    // One stroop of an 8-decimal token must not vanish.
    expect(stats.totalVolume).toBe(0.00000003);
  });

  it('keeps a large volume exact where a double cannot represent it', async () => {
    // Past 2^53 minor units a double can no longer hold every 8-decimal
    // value, so summing these two as floats rounds the total to
    // 90071992.54740995 instead of the exact 90071992.54740994.
    await seed('FUNDED', '90071992.54740993', 1);
    await seed('COMPLETED', '0.00000001', 2);

    const { stats } = await service.getTransactionStats(VENDOR);

    expect(stats.totalVolume).toBe(90071992.54740994);
    // Documents the behaviour this replaces.
    expect(90071992.54740993 + 0.00000001).not.toBe(90071992.54740994);
  });

  it('averages in decimal rather than dividing a rounded float total', async () => {
    // Three escrows of 0.1: exact total 0.3, exact average 0.1.
    await seed('FUNDED', '0.1', 1);
    await seed('FUNDED', '0.1', 2);
    await seed('COMPLETED', '0.1', 3);

    const { stats } = await service.getTransactionStats(VENDOR);

    expect(stats.totalVolume).toBe(0.3);
    expect(stats.averageTransactionValue).toBe(0.1);
  });

  it('computes activeVolume exactly for fractional active amounts', async () => {
    await seed('DELIVERED', '0.05', 1);
    await seed('SHIPPED', '0.05', 2);
    await seed('COMPLETED', '1000', 3);

    const { stats } = await service.getTransactionStats(VENDOR);

    expect(stats.activeVolume).toBe(0.1);
    expect(stats.totalVolume).toBe(1000.1);
  });

  it('returns zeros for a vendor with no escrows', async () => {
    const { stats } = await service.getTransactionStats(VENDOR);

    expect(stats.totalVolume).toBe(0);
    expect(stats.activeVolume).toBe(0);
    expect(stats.totalTransactions).toBe(0);
    expect(stats.averageTransactionValue).toBe(0);
    expect(stats.completionRate).toBe(0);
  });

  it('does not include another vendor\'s escrows', async () => {
    await ensureVendors(prisma, '0xOtherVendor');
    await seed('FUNDED', 100, 1);
    await prisma.escrow.create({
      data: {
        vendorAddress: '0xOtherVendor',
        itemName: 'Other',
        itemRef: 'ref-other',
        amount: 999,
        currency: 'USD',
        buyerAddress: '0xOtherBuyer',
        state: 'FUNDED',
      },
    });

    const { stats } = await service.getTransactionStats(VENDOR);

    expect(stats.totalTransactions).toBe(1);
    expect(stats.totalVolume).toBe(100);
  });
});
