import { Test } from '@nestjs/testing';
import { QueueDashboardService } from '../../src/admin/queues/queue-dashboard.service';

describe('QueueDashboardService (issue #75)', () => {
  let service: QueueDashboardService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [QueueDashboardService],
    }).compile();

    service = moduleRef.get(QueueDashboardService);
  });

  it('returns dashboard data with all registered queues', async () => {
    const dashboard = await service.getDashboard();

    expect(dashboard).toHaveProperty('queues');
    expect(dashboard).toHaveProperty('generatedAt');
    expect(Array.isArray(dashboard.queues)).toBe(true);
    expect(dashboard.queues.length).toBeGreaterThan(0);
  });

  it('includes auto-release and tracking-poll queues', async () => {
    const dashboard = await service.getDashboard();
    const names = dashboard.queues.map((q) => q.name);

    expect(names).toContain('auto-release');
    expect(names).toContain('tracking-poll');
  });

  it('each queue entry has the expected shape', async () => {
    const dashboard = await service.getDashboard();

    for (const queue of dashboard.queues) {
      expect(queue).toHaveProperty('name');
      expect(queue).toHaveProperty('isPaused');
      expect(queue).toHaveProperty('counts');
      expect(queue.counts).toMatchObject({
        waiting: expect.any(Number),
        active: expect.any(Number),
        completed: expect.any(Number),
        failed: expect.any(Number),
        delayed: expect.any(Number),
        paused: expect.any(Number),
      });
    }
  });

  it('generatedAt is a valid ISO-8601 timestamp', async () => {
    const dashboard = await service.getDashboard();
    const date = new Date(dashboard.generatedAt);
    expect(date.toISOString()).toBe(dashboard.generatedAt);
  });
});
