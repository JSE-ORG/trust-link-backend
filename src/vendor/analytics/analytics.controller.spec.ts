import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import type { AuthUser } from '../../auth/auth-user';
import type { AnalyticsStatsResponse } from './analytics-stats.dto';
import { ChartQueryDto } from './chart-query.dto';

type AnalyticsServiceMock = jest.Mocked<
  Pick<AnalyticsService, 'getTransactionStats' | 'getDailyVolumeChart'>
>;

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: AnalyticsServiceMock;

  const mockUser: AuthUser = { address: 'GVENDOR123' };

  beforeEach(async () => {
    service = {
      getTransactionStats: jest.fn(),
      getDailyVolumeChart: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: service }],
    }).compile();

    controller = module.get(AnalyticsController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('missing authenticated user (#671)', () => {
    it('getTransactionStats throws UnauthorizedException, not a 500', async () => {
      await expect(controller.getTransactionStats(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(service.getTransactionStats).not.toHaveBeenCalled();
    });

    it('getDailyVolumeChart throws UnauthorizedException, not a 500', async () => {
      await expect(
        controller.getDailyVolumeChart(undefined, undefined),
      ).rejects.toThrow(UnauthorizedException);
      expect(service.getDailyVolumeChart).not.toHaveBeenCalled();
    });
  });

  describe('GET /vendor/analytics', () => {
    it('delegates to service with user address', async () => {
      const statsResponse: AnalyticsStatsResponse = {
        stats: {
          totalVolume: 0,
          activeVolume: 0,
          totalTransactions: 0,
          activeTransactions: 0,
          completedTransactions: 0,
          completionRate: 0,
          disputedTransactions: 0,
          disputeRate: 0,
          averageTransactionValue: 0,
          cancelledTransactions: 0,
        },
        channels: {
          email: { notificationsEnabled: false },
          sms: { notificationsEnabled: false },
        },
        lastUpdated: new Date().toISOString(),
      };
      service.getTransactionStats.mockResolvedValue(statsResponse);

      const result = await controller.getTransactionStats(mockUser);

      expect(service.getTransactionStats).toHaveBeenCalledWith('GVENDOR123');
      expect(result).toBe(statsResponse);
    });
  });

  describe('GET /vendor/analytics/chart', () => {
    const chartResponse = {
      data: [],
      period: { startDate: '', endDate: '' },
      summary: { totalVolume: 0, totalTransactions: 0, averageDaily: 0 },
    };

    beforeEach(() => {
      service.getDailyVolumeChart.mockResolvedValue(chartResponse);
    });

    it('applies default params when query is undefined or empty', async () => {
      await controller.getDailyVolumeChart(undefined, mockUser);

      expect(service.getDailyVolumeChart).toHaveBeenCalledWith(
        'GVENDOR123',
        30,
        'UTC',
      );

      const emptyQuery = new ChartQueryDto();
      await controller.getDailyVolumeChart(emptyQuery, mockUser);

      expect(service.getDailyVolumeChart).toHaveBeenCalledWith(
        'GVENDOR123',
        30,
        'UTC',
      );
    });

    it('passes custom days param through', async () => {
      const query = Object.assign(new ChartQueryDto(), { days: 7 });
      await controller.getDailyVolumeChart(query, mockUser);

      expect(service.getDailyVolumeChart).toHaveBeenCalledWith(
        'GVENDOR123',
        7,
        'UTC',
      );
    });

    it('passes custom timezone param through', async () => {
      const query = Object.assign(new ChartQueryDto(), {
        timezone: 'America/New_York',
      });
      await controller.getDailyVolumeChart(query, mockUser);

      expect(service.getDailyVolumeChart).toHaveBeenCalledWith(
        'GVENDOR123',
        30,
        'America/New_York',
      );
    });

    it('passes both custom days and timezone', async () => {
      const query = Object.assign(new ChartQueryDto(), {
        days: 14,
        timezone: 'Europe/London',
      });
      await controller.getDailyVolumeChart(query, mockUser);

      expect(service.getDailyVolumeChart).toHaveBeenCalledWith(
        'GVENDOR123',
        14,
        'Europe/London',
      );
    });
  });
});
