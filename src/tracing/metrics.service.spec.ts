import {
  MetricsService,
  httpRequestsCounter,
  httpRequestDurationHistogram,
  workerCycleCounter,
  workerCycleDurationHistogram,
  dlqSizeCounter,
  pollerLedgerLagHistogram,
} from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('records http request metrics with attributes', () => {
    const counterSpy = jest.spyOn(httpRequestsCounter, 'add');
    const histSpy = jest.spyOn(httpRequestDurationHistogram, 'record');

    service.recordHttpRequest('/escrow/123', 'GET', 200, 45);

    expect(counterSpy).toHaveBeenCalledWith(1, {
      route: '/escrow/123',
      method: 'GET',
      status: '200',
    });
    expect(histSpy).toHaveBeenCalledWith(45, {
      route: '/escrow/123',
      method: 'GET',
      status: '200',
    });
  });

  it('records worker cycle metrics with attributes', () => {
    const counterSpy = jest.spyOn(workerCycleCounter, 'add');
    const histSpy = jest.spyOn(workerCycleDurationHistogram, 'record');

    service.recordWorkerCycle('auto-release', 'success', 120);

    expect(counterSpy).toHaveBeenCalledWith(1, {
      worker: 'auto-release',
      outcome: 'success',
    });
    expect(histSpy).toHaveBeenCalledWith(120, {
      worker: 'auto-release',
      outcome: 'success',
    });
  });

  it('records dlq size change', () => {
    const counterSpy = jest.spyOn(dlqSizeCounter, 'add');

    service.recordDlqSize(1);
    expect(counterSpy).toHaveBeenCalledWith(1);

    service.recordDlqSize(-1);
    expect(counterSpy).toHaveBeenCalledWith(-1);
  });

  it('records poller ledger lag', () => {
    const histSpy = jest.spyOn(pollerLedgerLagHistogram, 'record');

    service.recordPollerLag(5);
    expect(histSpy).toHaveBeenCalledWith(5);
  });
});
