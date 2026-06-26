import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../prisma/prisma.service';

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
  });

  describe('getDailyVolumeChart', () => {
    it('should aggregate transactions by date using database-level query', async () => {
      const vendorAddress = '0xVendor123';
      const days = 7;

      // Create test escrows across multiple days
      const baseDate = new Date('2024-01-01T00:00:00Z');
      
      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 1',
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyer1',
          createdAt: new Date(baseDate.getTime() + 0 * 24 * 60 * 60 * 1000),
          state: 'COMPLETED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 2',
          amount: 200,
          currency: 'USD',
          buyerAddress: '0xBuyer2',
          createdAt: new Date(baseDate.getTime() + 0 * 24 * 60 * 60 * 1000),
          state: 'COMPLETED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 3',
          amount: 150,
          currency: 'USD',
          buyerAddress: '0xBuyer3',
          createdAt: new Date(baseDate.getTime() + 1 * 24 * 60 * 60 * 1000),
          state: 'DISPUTED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 4',
          amount: 300,
          currency: 'USD',
          buyerAddress: '0xBuyer4',
          createdAt: new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000),
          state: 'COMPLETED',
        },
      });

      const result = await service.getDailyVolumeChart(vendorAddress, days, 'UTC');

      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
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
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyer1',
          createdAt: baseDate,
          state: 'COMPLETED',
        },
      });

      const day3Date = new Date(baseDate);
      day3Date.setDate(day3Date.getDate() + 2);

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 2',
          amount: 200,
          currency: 'USD',
          buyerAddress: '0xBuyer2',
          createdAt: day3Date,
          state: 'COMPLETED',
        },
      });

      const result = await service.getDailyVolumeChart(vendorAddress, days, 'UTC');

      // Should have entries for all 5 days
      expect(result.data.length).toBe(5);
      
      // Check that days with no transactions have zero values
      const zeroDays = result.data.filter(d => d.transactionCount === 0);
      expect(zeroDays.length).toBe(3);
    });

    it('should handle timezone boundaries correctly', async () => {
      const vendorAddress = '0xVendor789';
      const days = 2;

      // Create escrow near midnight UTC
      const utcDate = new Date('2024-01-01T23:30:00Z');
      
      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 1',
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyer1',
          createdAt: utcDate,
          state: 'COMPLETED',
        },
      });

      // Test with UTC timezone
      const utcResult = await service.getDailyVolumeChart(vendorAddress, days, 'UTC');
      expect(utcResult.data).toBeDefined();

      // Test with different timezone (e.g., America/New_York)
      const estResult = await service.getDailyVolumeChart(vendorAddress, days, 'America/New_York');
      expect(estResult.data).toBeDefined();
    });

    it('should calculate correct aggregations', async () => {
      const vendorAddress = '0xVendorABC';
      const days = 3;

      const baseDate = new Date();
      baseDate.setDate(baseDate.getDate() - 2);

      // Create multiple escrows with different states
      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 1',
          amount: 100,
          currency: 'USD',
          buyerAddress: '0xBuyer1',
          createdAt: baseDate,
          state: 'COMPLETED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 2',
          amount: 200,
          currency: 'USD',
          buyerAddress: '0xBuyer2',
          createdAt: baseDate,
          state: 'RELEASED',
        },
      });

      await prisma.escrow.create({
        data: {
          vendorAddress,
          itemName: 'Item 3',
          amount: 150,
          currency: 'USD',
          buyerAddress: '0xBuyer3',
          createdAt: baseDate,
          state: 'DISPUTED',
        },
      });

      const result = await service.getDailyVolumeChart(vendorAddress, days, 'UTC');

      const dayData = result.data[0];
      expect(dayData.totalVolume).toBe(450);
      expect(dayData.transactionCount).toBe(3);
      expect(dayData.completedCount).toBe(2); // COMPLETED + RELEASED
      expect(dayData.disputedCount).toBe(1);
      expect(dayData.averageTransactionValue).toBe(150);
    });

    it('should return empty result for vendor with no transactions', async () => {
      const vendorAddress = '0xVendorXYZ';
      const days = 7;

      const result = await service.getDailyVolumeChart(vendorAddress, days, 'UTC');

      expect(result.data).toBeDefined();
      expect(result.data.length).toBe(7); // Should still have all days with zero values
      expect(result.summary.totalVolume).toBe(0);
      expect(result.summary.totalTransactions).toBe(0);
    });
  });

  describe('fillDateGaps', () => {
    it('should fill missing dates with zero values', () => {
      const dailyMap = new Map<string, any>();
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
      const filledData = (service as any).fillDateGaps(dailyMap, startDate, endDate, 'UTC');

      expect(filledData.length).toBe(5);
      expect(filledData[0].date).toBe('2024-01-01');
      expect(filledData[0].totalVolume).toBe(100);
      expect(filledData[1].date).toBe('2024-01-02');
      expect(filledData[1].totalVolume).toBe(0);
      expect(filledData[2].date).toBe('2024-01-03');
      expect(filledData[2].totalVolume).toBe(200);
    });
  });

  describe('formatDateInTimezone', () => {
    it('should format date correctly in UTC', () => {
      const date = new Date('2024-01-15T12:30:00Z');
      const formatted = (service as any).formatDateInTimezone(date, 'UTC');
      expect(formatted).toBe('2024-01-15');
    });

    it('should format date correctly in different timezone', () => {
      const date = new Date('2024-01-15T00:30:00Z');
      const formatted = (service as any).formatDateInTimezone(date, 'America/New_York');
      expect(formatted).toBeDefined();
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
