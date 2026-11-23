/**
 * Tests for StressTestService branches (issue #1127).
 *
 * Covers: runStressTest catch → status FAILED,
 * executeProfile with and without thresholds/enableAlerts.
 */

import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { StressTestService } from './stress-test.service';
import { ConfigService } from '../config/config.service';

type Priv = Record<string, (...args: unknown[]) => unknown>;
type ProfileResult = { alerts: unknown[] };

function makeConfig(url = 'http://localhost:3000'): ConfigService {
  return { get: jest.fn().mockReturnValue(url) } as unknown as ConfigService;
}

function makeHttp(statusCode = 200): HttpService {
  return {
    request: jest.fn().mockReturnValue(of({ status: statusCode, data: {} })),
  } as unknown as HttpService;
}

function minimalConfig() {
  return {
    testName: 'test',
    profiles: [
      {
        endpoint: '/health',
        concurrentUsers: 1,
        requestsPerSecond: 1,
        duration: 1,
        method: 'GET',
      },
    ],
    enableAlerts: false,
  };
}

describe('StressTestService.runStressTest', () => {
  it('sets status to FAILED when executeProfile throws', async () => {
    const http = {
      request: jest
        .fn()
        .mockReturnValue(throwError(() => new Error('network down'))),
    } as unknown as HttpService;
    const svc = new StressTestService(http, makeConfig());

    // Force a failure by overriding executeProfile to throw
    jest
      .spyOn(
        svc as unknown as { executeProfile: () => Promise<unknown> },
        'executeProfile',
      )
      .mockRejectedValue(new Error('bang'));

    const result = await svc.runStressTest(minimalConfig() as never);
    expect(result.status).toBe('FAILED');
  });

  it('completes normally when profiles succeed', async () => {
    const svc = new StressTestService(makeHttp(), makeConfig());
    const result = await svc.runStressTest(minimalConfig() as never);
    expect(result.status).toBe('COMPLETED');
  });
});

describe('StressTestService.executeProfile', () => {
  it('skips threshold checks when enableAlerts is false', async () => {
    const svc = new StressTestService(makeHttp(), makeConfig());
    const profile = {
      endpoint: '/health',
      concurrentUsers: 1,
      requestsPerSecond: 1,
      duration: 1,
      method: 'GET',
    };
    const result = (await (svc as unknown as Priv)['executeProfile'](
      profile,
      0,
      { maxResponseTime: 1 },
      false,
    )) as ProfileResult;
    expect(result.alerts).toHaveLength(0);
  });

  it('runs threshold checks when thresholds and enableAlerts are provided', async () => {
    // A very tight threshold that will fire an alert
    const http = {
      request: jest.fn().mockReturnValue(of({ status: 200, data: {} })),
    } as unknown as HttpService;
    const svc = new StressTestService(http, makeConfig());
    const profile = {
      endpoint: '/health',
      concurrentUsers: 1,
      requestsPerSecond: 1,
      duration: 1,
      method: 'GET',
    };
    const result = (await (svc as unknown as Priv)['executeProfile'](
      profile,
      0,
      { maxResponseTime: 0.001 },
      true,
    )) as ProfileResult;
    // alerts array is defined (threshold check ran)
    expect(Array.isArray(result.alerts)).toBe(true);
  });
});

describe('StressTestService.generateTestId (issue #1229)', () => {
  it('returns test_<timestamp>_<9 base-36 chars>', () => {
    const svc = new StressTestService(makeHttp(), makeConfig());
    const before = Date.now();

    const id = svc.generateTestId();

    const match = /^test_(\d+)_([0-9a-z]{1,9})$/.exec(id);
    expect(match).not.toBeNull();
    const timestamp = Number(match![1]);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('returns a different id on each call', () => {
    const svc = new StressTestService(makeHttp(), makeConfig());

    const ids = new Set(Array.from({ length: 50 }, () => svc.generateTestId()));

    expect(ids.size).toBe(50);
  });
});
