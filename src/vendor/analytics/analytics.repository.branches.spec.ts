/**
 * Tests for AnalyticsRepository fallback branches (issue #1126).
 *
 * Covers: findNotificationChannels — null when no settings row exists.
 */

import { AnalyticsRepository } from './analytics.repository';
import { PrismaService } from '../../prisma/prisma.service';

describe('AnalyticsRepository.findNotificationChannels', () => {
  it('returns null when no vendorTrackingSettings row exists', async () => {
    const prisma = {
      vendorTrackingSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new AnalyticsRepository(prisma);

    const result = await repo.findNotificationChannels('VENDOR');
    expect(result).toBeNull();
  });

  it('returns channels when a settings row exists', async () => {
    const prisma = {
      vendorTrackingSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ notificationChannels: ['EMAIL', 'SMS'] }),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new AnalyticsRepository(prisma);

    const result = await repo.findNotificationChannels('VENDOR');
    expect(result).toEqual(['EMAIL', 'SMS']);
  });
});

describe('AnalyticsRepository.aggregateDailyVolume intervals', () => {
  const start = new Date('2024-01-01T00:00:00.000Z');
  const end = new Date('2024-03-31T23:59:59.999Z');

  it.each(['day', 'week', 'month'] as const)(
    'uses DATE_TRUNC(%s, ...) for interval "%s"',
    async (interval) => {
      const queryRaw = jest.fn().mockResolvedValue([]);
      const prisma = {
        $queryRaw: queryRaw,
      } as unknown as jest.Mocked<PrismaService>;
      const repo = new AnalyticsRepository(prisma);

      await repo.aggregateDailyVolume('VENDOR', start, end, 'UTC', interval);

      expect(queryRaw).toHaveBeenCalledTimes(1);
      const [strings] = queryRaw.mock.calls[0] as [TemplateStringsArray];
      const sql = strings.join('?');
      expect(sql).toContain(`DATE_TRUNC('${interval}',`);
    },
  );
});
