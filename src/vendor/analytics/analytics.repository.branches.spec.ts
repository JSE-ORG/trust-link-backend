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
        findUnique: jest.fn().mockResolvedValue({ notificationChannels: ['EMAIL', 'SMS'] }),
      },
    } as unknown as jest.Mocked<PrismaService>;
    const repo = new AnalyticsRepository(prisma);

    const result = await repo.findNotificationChannels('VENDOR');
    expect(result).toEqual(['EMAIL', 'SMS']);
  });
});
