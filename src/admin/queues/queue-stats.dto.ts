/**
 * Issue #75 – Shape of the queue statistics returned by the dashboard endpoint.
 */
export interface QueueJobCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface QueueStatsDto {
  name: string;
  counts: QueueJobCounts;
  isPaused: boolean;
}

export interface QueuesDashboardDto {
  queues: QueueStatsDto[];
  generatedAt: string;
}
