import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '../../config/config.service';
import { QueuesDashboardDto, QueueStatsDto } from './queue-stats.dto';

/**
 * Issue #305 – Real BullMQ queue dashboard service.
 *
 * Connects to actual BullMQ Queue instances to return accurate job counts
 * for waiting/active/completed/failed/delayed jobs. Falls back gracefully
 * when Redis is unavailable.
 */

@Injectable()
export class QueueDashboardService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(QueueDashboardService.name);
  private readonly queues: Queue[] = [];
  private redisConnected = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const redisUrl = this.config.get('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL not set; dashboard will return empty queue data',
      );
      return;
    }

    const queueNames = ['auto-release', 'tracking-poll', 'notifications-retry'];

    for (const name of queueNames) {
      try {
        const queue = new Queue(name, {
          connection: { url: redisUrl },
        });
        this.queues.push(queue);
        this.redisConnected = true;
      } catch (err) {
        this.logger.warn(
          `Failed to create queue ${name}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }

    if (this.redisConnected) {
      this.logger.log(
        `Dashboard connected to ${this.queues.length} BullMQ queues`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const queue of this.queues) {
      try {
        await queue.close();
      } catch {
        // Ignore close errors during shutdown
      }
    }
  }

  async getDashboard(): Promise<QueuesDashboardDto> {
    this.logger.log(
      JSON.stringify({ msg: 'admin.queues.dashboard_requested' }),
    );

    if (!this.redisConnected || this.queues.length === 0) {
      return {
        queues: this.getEmptyStats(),
        generatedAt: new Date().toISOString(),
      };
    }

    const stats: QueueStatsDto[] = await Promise.all(
      this.queues.map(async (queue) => {
        try {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
            'paused',
          );
          const isPaused = await queue.isPaused();
          return { name: queue.name, counts, isPaused };
        } catch (err) {
          this.logger.warn(
            `Failed to get counts for queue ${queue.name}: ` +
              (err instanceof Error ? err.message : String(err)),
          );
          return {
            name: queue.name,
            counts: {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
              paused: 0,
            },
            isPaused: false,
          };
        }
      }),
    );

    return {
      queues: stats,
      generatedAt: new Date().toISOString(),
    };
  }

  private getEmptyStats(): QueueStatsDto[] {
    return [
      {
        name: 'auto-release',
        counts: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        },
        isPaused: false,
      },
      {
        name: 'tracking-poll',
        counts: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        },
        isPaused: false,
      },
      {
        name: 'notifications-retry',
        counts: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        },
        isPaused: false,
      },
    ];
  }
}
