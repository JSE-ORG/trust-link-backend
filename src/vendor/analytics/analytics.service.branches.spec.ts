/**
 * Tests for AnalyticsService branches (issue #1127).
 *
 * Covers: toDateKey (Date vs string), getTransactionStats zero groups,
 * getTransactionStats null channels → DEFAULT_NOTIFICATION_CHANNELS,
 * rate calculation when totalTransactions > 0.
 */

import { Prisma } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository } from './analytics.repository';
import { DEFAULT_NOTIFICATION_CHANNELS } from '../vendor.constants';

type Priv = Record<string, (...args: any[]) => any>;

function makeService(
  repo: Partial<jest.Mocked<AnalyticsRepository>>,
): AnalyticsService {
  return new AnalyticsService(repo as unknown as AnalyticsRepository);
}

describe('AnalyticsService.toDateKey', () => {
  let svc: AnalyticsService;
  beforeEach(() => {
    svc = makeService({
      aggregateDailyVolume: jest.fn().mockResolvedValue([]),
    });
  });

  it('slices ISO string from a Date instance', () => {
    const d = new Date('2024-03-15T12:00:00.000Z');
    expect((svc as unknown as Priv)['toDateKey'](d)).toBe('2024-03-15');
  });

  it('slices first 10 chars from a plain string', () => {
    expect((svc as unknown as Priv)['toDateKey']('2024-03-15T00:00:00')).toBe(
      '2024-03-15',
    );
  });
});

describe('AnalyticsService.getTransactionStats', () => {
  it('returns all-zero stats when there are no escrow groups', async () => {
    const repo = {
      getEscrowStateGroups: jest.fn().mockResolvedValue([]),
      findNotificationChannels: jest.fn().mockResolvedValue(['EMAIL']),
      getAverageShippingAndDeliveryTimes: jest.fn().mockResolvedValue({
        averageHoursToShip: null,
        averageHoursToDeliver: null,
      }),
    } as unknown as jest.Mocked<AnalyticsRepository>;
    const svc = makeService(repo);

    const result = await svc.getTransactionStats('VENDOR');
    expect(result.stats.totalTransactions).toBe(0);
    expect(result.stats.completionRate).toBe(0);
  });

  it('uses DEFAULT_NOTIFICATION_CHANNELS when findNotificationChannels returns null', async () => {
    const repo = {
      getEscrowStateGroups: jest.fn().mockResolvedValue([]),
      findNotificationChannels: jest.fn().mockResolvedValue(null),
      getAverageShippingAndDeliveryTimes: jest.fn().mockResolvedValue({
        averageHoursToShip: null,
        averageHoursToDeliver: null,
      }),
    } as unknown as jest.Mocked<AnalyticsRepository>;
    const svc = makeService(repo);

    const result = await svc.getTransactionStats('VENDOR');
    const emailEnabled = result.channels.email.notificationsEnabled;
    expect(emailEnabled).toBe(DEFAULT_NOTIFICATION_CHANNELS.includes('EMAIL'));
  });

  it('calculates rates when there are transactions', async () => {
    const groups = [
      {
        state: 'COMPLETED',
        _count: 3,
        _sum: { amount: new Prisma.Decimal(300) },
      },
      {
        state: 'DISPUTED',
        _count: 1,
        _sum: { amount: new Prisma.Decimal(100) },
      },
    ];
    const repo = {
      getEscrowStateGroups: jest.fn().mockResolvedValue(groups),
      findNotificationChannels: jest.fn().mockResolvedValue(null),
      getAverageShippingAndDeliveryTimes: jest.fn().mockResolvedValue({
        averageHoursToShip: null,
        averageHoursToDeliver: null,
      }),
    } as unknown as jest.Mocked<AnalyticsRepository>;
    const svc = makeService(repo);

    const result = await svc.getTransactionStats('VENDOR');
    expect(result.stats.completionRate).toBeGreaterThan(0);
    expect(result.stats.averageTransactionValue).toBeGreaterThan(0);
  });
  it('includes speed metrics from getAverageShippingAndDeliveryTimes (issue #1154)', async () => {
    const repo = {
      getEscrowStateGroups: jest.fn().mockResolvedValue([]),
      findNotificationChannels: jest.fn().mockResolvedValue(null),
      getAverageShippingAndDeliveryTimes: jest.fn().mockResolvedValue({
        averageHoursToShip: 4.5,
        averageHoursToDeliver: 12.3,
      }),
    } as unknown as jest.Mocked<AnalyticsRepository>;
    const svc = makeService(repo);

    const result = await svc.getTransactionStats('VENDOR');
    expect(result.stats.averageHoursToShip).toBe(4.5);
    expect(result.stats.averageHoursToDeliver).toBe(12.3);
  });
});
