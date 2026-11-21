import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsController } from './admin-stats.controller';

describe('AdminStatsController', () => {
  const adminStatsService: jest.Mocked<
    Pick<AdminStatsService, 'getStats' | 'getChart'>
  > = {
    getStats: jest.fn(),
    getChart: jest.fn(),
  };
  const controller = new AdminStatsController(
    adminStatsService as unknown as AdminStatsService,
  );

  afterEach(() => jest.clearAllMocks());

  it('applies JWT and admin guards to the controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminStatsController)).toEqual([
      JwtGuard,
      AdminGuard,
    ]);
  });

  it('returns the stats service result unchanged', async () => {
    const expected = { totalEscrows: 12, totalVolume: 3500 };
    adminStatsService.getStats.mockResolvedValue(expected as never);

    await expect(controller.getStats()).resolves.toBe(expected);
    expect(adminStatsService.getStats).toHaveBeenCalledWith();
  });

  it('returns the chart service result unchanged', async () => {
    const expected = [
      {
        date: '2026-11-20',
        escrowsCreated: 5,
        volume: 1200,
        completed: 4,
        disputed: 0,
      },
    ];
    adminStatsService.getChart.mockResolvedValue(expected);

    await expect(controller.getChart({ days: 14 })).resolves.toBe(expected);
    expect(adminStatsService.getChart).toHaveBeenCalledWith(14);
  });
});
