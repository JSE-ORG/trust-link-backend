/**
 * Issue #75 – Shape of the queue statistics returned by the dashboard endpoint.
 */

/**
 * Job count breakdown for a single BullMQ queue.
 */
export interface QueueJobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

/**
 * Statistics for a single BullMQ queue including its name, job counts,
 * and whether the queue is currently paused.
 */
export interface QueueStatsDto {
  name: string;
  counts: QueueJobCounts;
  isPaused: boolean;
}

/**
 * Response shape for GET /admin/queues containing real-time job
 * counts for every registered BullMQ queue.
 */
export interface QueuesDashboardDto {
  queues: QueueStatsDto[];
  generatedAt: string;
}
