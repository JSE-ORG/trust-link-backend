import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { QueueDashboardService } from './queue-dashboard.service';
import { QueueDashboardController } from './queue-dashboard.controller';

describe('QueueDashboardController', () => {
  const dashboardService: jest.Mocked<
    Pick<QueueDashboardService, 'getDashboard'>
  > = { getDashboard: jest.fn() };
  const controller = new QueueDashboardController(
    dashboardService as unknown as QueueDashboardService,
  );

  afterEach(() => jest.clearAllMocks());

  it('applies JWT and admin guards to the controller', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, QueueDashboardController),
    ).toEqual([JwtGuard, AdminGuard]);
  });

  it('returns the dashboard service result unchanged', async () => {
    const expected = { queues: [], generatedAt: '2026-09-27T00:00:00.000Z' };
    dashboardService.getDashboard.mockResolvedValue(expected);

    await expect(controller.getDashboard()).resolves.toBe(expected);
    expect(dashboardService.getDashboard).toHaveBeenCalledWith();
  });
});
