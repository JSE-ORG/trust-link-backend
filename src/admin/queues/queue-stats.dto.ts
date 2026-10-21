import { ApiProperty } from '@nestjs/swagger';

/**
 * Issue #75 – Shape of the queue statistics returned by the dashboard endpoint.
 */

/**
 * Job count breakdown for a single BullMQ queue.
 */
export class QueueJobCounts {
  @ApiProperty({
    description: 'Number of jobs waiting to be processed.',
    example: 0,
  })
  waiting!: number;

  @ApiProperty({
    description: 'Number of jobs currently being processed.',
    example: 1,
  })
  active!: number;

  @ApiProperty({
    description: 'Number of successfully completed jobs.',
    example: 42,
  })
  completed!: number;

  @ApiProperty({
    description: 'Number of failed jobs.',
    example: 0,
  })
  failed!: number;

  @ApiProperty({
    description: 'Number of delayed jobs scheduled for future execution.',
    example: 0,
  })
  delayed!: number;

  @ApiProperty({
    description: 'Number of paused jobs.',
    example: 0,
  })
  paused!: number;
}

/**
 * Statistics for a single BullMQ queue including its name, job counts,
 * and whether the queue is currently paused.
 */
export class QueueStatsDto {
  @ApiProperty({
    description: 'Name of the queue.',
    example: 'auto-release',
  })
  name!: string;

  @ApiProperty({
    description: 'Breakdown of job counts by status.',
    type: QueueJobCounts,
  })
  counts!: QueueJobCounts;

  @ApiProperty({
    description: 'Whether the queue is currently paused.',
    example: false,
  })
  isPaused!: boolean;
}

/**
 * Response shape for GET /admin/queues containing real-time job
 * counts for every registered BullMQ queue.
 */
export class QueuesDashboardDto {
  @ApiProperty({
    description: 'List of statistics for each registered queue.',
    type: [QueueStatsDto],
  })
  queues!: QueueStatsDto[];

  @ApiProperty({
    description:
      'ISO-8601 timestamp when this dashboard snapshot was generated.',
    type: String,
    format: 'date-time',
    example: '2026-05-27T10:00:00.000Z',
  })
  generatedAt!: string;
}
