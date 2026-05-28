import { Injectable, Logger } from '@nestjs/common';
import { QueuesDashboardDto, QueueStatsDto } from './queue-stats.dto';

/**
 * Issue #75 – BullMQ queue dashboard service.
 *
 * In a full BullMQ integration this service would inject Queue instances
 * (via @InjectQueue) and call queue.getJobCounts() on each one.
 *
 * Because BullMQ / ioredis are not available in this environment the service
 * uses an in-process mock that mirrors the real BullMQ Queue API surface.
 * Swapping the mock for real queues only requires:
 *   1. `npm install bullmq ioredis`
 *   2. Register BullModule.forRoot / BullModule.registerQueue in the module.
 *   3. Replace MockQueue with @InjectQueue('auto-release') queue: Queue, etc.
 */

// ---------------------------------------------------------------------------
// Mock queue – mirrors the BullMQ Queue public API used here
// ---------------------------------------------------------------------------

interface MockJobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

class MockQueue {
  constructor(
    public readonly name: string,
    private readonly counts: MockJobCounts,
    private paused = false,
  ) {}

  async getJobCounts(): Promise<MockJobCounts> {
    return { ...this.counts };
  }

  async isPaused(): Promise<boolean> {
    return this.paused;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class QueueDashboardService {
  private readonly logger = new Logger(QueueDashboardService.name);

  /**
   * Registry of queues to monitor.
   *
   * Replace MockQueue instances with real BullMQ Queue objects when the
   * dependency is available.
   */
  private readonly queues: MockQueue[] = [
    new MockQueue('auto-release', {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    }),
    new MockQueue('tracking-poll', {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    }),
  ];

  async getDashboard(): Promise<QueuesDashboardDto> {
    this.logger.log(
      JSON.stringify({ msg: 'admin.queues.dashboard_requested' }),
    );

    const stats: QueueStatsDto[] = await Promise.all(
      this.queues.map(async (queue) => {
        const counts = await queue.getJobCounts();
        const isPaused = await queue.isPaused();
        return { name: queue.name, counts, isPaused };
      }),
    );

    return {
      queues: stats,
      generatedAt: new Date().toISOString(),
    };
  }
}
