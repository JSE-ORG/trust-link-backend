import { Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('trustlink-backend', '1.0.0');

export const httpRequestsCounter = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests processed',
});

export const httpRequestDurationHistogram = meter.createHistogram(
  'http_request_duration_ms',
  {
    description: 'Duration of HTTP requests in milliseconds',
    unit: 'ms',
  },
);

export const workerCycleDurationHistogram = meter.createHistogram(
  'worker_cycle_duration_ms',
  {
    description: 'Duration of background worker cycles in milliseconds',
    unit: 'ms',
  },
);

export const workerCycleCounter = meter.createCounter('worker_cycle_total', {
  description: 'Total number of completed background worker cycles',
});

export const dlqSizeCounter = meter.createUpDownCounter('dlq_size', {
  description: 'Current number of items in the dead-letter queue',
});

export const pollerLedgerLagHistogram = meter.createHistogram(
  'poller_ledger_lag',
  {
    description: 'Lag in ledgers between chain head and processed events',
    unit: 'ledgers',
  },
);

@Injectable()
export class MetricsService {
  /**
   * Records count and duration metrics for an HTTP request.
   *
   * @param route Route pattern.
   * @param method HTTP method.
   * @param status HTTP response status code.
   * @param durationMs Request processing duration in milliseconds.
   */
  recordHttpRequest(
    route: string,
    method: string,
    status: number,
    durationMs: number,
  ): void {
    const attributes = { route, method, status: String(status) };
    httpRequestsCounter.add(1, attributes);
    httpRequestDurationHistogram.record(durationMs, attributes);
  }

  /**
   * Records execution count and duration metrics for a background worker cycle.
   *
   * @param worker Worker name.
   * @param outcome Execution outcome ('success' or 'error').
   * @param durationMs Cycle duration in milliseconds.
   */
  recordWorkerCycle(
    worker: string,
    outcome: 'success' | 'error',
    durationMs: number,
  ): void {
    const attributes = { worker, outcome };
    workerCycleCounter.add(1, attributes);
    workerCycleDurationHistogram.record(durationMs, attributes);
  }

  /**
   * Increments the dead-letter queue count metric.
   *
   * @param size Number of dead-letter records to increment.
   */
  recordDlqSize(size: number): void {
    dlqSizeCounter.add(size);
  }

  /**
   * Records lag between latest ledger and processed ledger for the poller.
   *
   * @param lag Ledger lag count.
   */
  recordPollerLag(lag: number): void {
    pollerLedgerLagHistogram.record(lag);
  }
}
