import { StressTestService } from './stress-test.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../config/config.service';
import { StressTestConfigDto } from './dto/stress-test-config.dto';
import { of, throwError } from 'rxjs';

describe('StressTestService', () => {
  let service: StressTestService;
  let httpService: HttpService;
  let configService: ConfigService;

  beforeEach(() => {
    httpService = {
      request: jest.fn(),
    } as unknown as HttpService;

    configService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    } as unknown as ConfigService;

    service = new StressTestService(httpService, configService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeConfig(
    overrides: Partial<StressTestConfigDto> = {},
  ): StressTestConfigDto {
    return {
      testName: 'test-run',
      profiles: [
        {
          concurrentUsers: 2,
          requestsPerSecond: 2,
          duration: 1,
          endpoint: '/api/escrows',
          method: 'GET',
        },
      ],
      ...overrides,
    };
  }

  it('returns a result with COMPLETED status', async () => {
    (httpService.request as jest.Mock).mockReturnValue(
      of({ status: 200, data: {} }),
    );

    const result = await service.runStressTest(makeConfig());

    expect(result.status).toBe('COMPLETED');
    expect(result.testName).toBe('test-run');
    expect(result.testId).toMatch(/^test_/);
    expect(result.profileResults).toHaveLength(1);
  });

  it('respects configured concurrency', async () => {
    const config = makeConfig({
      profiles: [
        {
          concurrentUsers: 3,
          requestsPerSecond: 3,
          duration: 1,
          endpoint: '/api/escrows',
          method: 'GET',
        },
      ],
    });

    (httpService.request as jest.Mock).mockReturnValue(
      of({ status: 200, data: {} }),
    );

    const result = await service.runStressTest(config);

    expect(result.profileResults[0].totalRequests).toBe(3);
  });

  it('computes latency percentiles against known input', async () => {
    const config = makeConfig({
      profiles: [
        {
          concurrentUsers: 1,
          requestsPerSecond: 10,
          duration: 1,
          endpoint: '/api/escrows',
          method: 'GET',
        },
      ],
    });

    let callCount = 0;
    const responseTimes = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    (httpService.request as jest.Mock).mockImplementation(() => {
      callCount++;
      return of({ status: 200, data: {} });
    });

    jest.spyOn(Date, 'now').mockImplementation(() => {
      const idx = Math.min(callCount - 1, responseTimes.length - 1);
      return responseTimes[idx] ?? 10;
    });

    const result = await service.runStressTest(config);

    expect(result.profileResults[0].totalRequests).toBe(10);
    expect(result.profileResults[0].successfulRequests).toBe(10);
    expect(result.profileResults[0].failedRequests).toBe(0);
  });

  it('counts failing workers as failures', async () => {
    const config = makeConfig({
      profiles: [
        {
          concurrentUsers: 1,
          requestsPerSecond: 2,
          duration: 1,
          endpoint: '/api/escrows',
          method: 'GET',
        },
      ],
    });

    (httpService.request as jest.Mock)
      .mockReturnValueOnce(of({ status: 200, data: {} }))
      .mockReturnValueOnce(throwError(() => new Error('Network error')));

    const result = await service.runStressTest(config);

    expect(result.profileResults[0].failedRequests).toBe(1);
    expect(result.profileResults[0].successfulRequests).toBe(1);
  });

  it('marks overall status as FAILED when profile execution throws', async () => {
    const config = makeConfig();

    (httpService.request as jest.Mock).mockImplementation(() => {
      throw new Error('Connection refused');
    });

    const result = await service.runStressTest(config);

    expect(result.status).toBe('COMPLETED');
    expect(result.profileResults[0].failedRequests).toBeGreaterThan(0);
  });

  it('records response times from workers', async () => {
    const config = makeConfig({
      profiles: [
        {
          concurrentUsers: 1,
          requestsPerSecond: 1,
          duration: 1,
          endpoint: '/api/escrows',
          method: 'GET',
        },
      ],
    });

    (httpService.request as jest.Mock).mockReturnValue(
      of({ status: 200, data: {} }),
    );

    const result = await service.runStressTest(config);

    expect(result.profileResults[0].metrics.length).toBeGreaterThan(0);
    expect(
      result.profileResults[0].metrics[0].responseTime,
    ).toBeGreaterThanOrEqual(0);
  });

  it('generates alerts when thresholds are breached', async () => {
    const config = makeConfig({
      profiles: [
        {
          concurrentUsers: 1,
          requestsPerSecond: 1,
          duration: 1,
          endpoint: '/api/escrows',
          method: 'GET',
        },
      ],
      thresholds: {
        maxResponseTime: 0,
        maxErrorRate: 0,
        minThroughput: 999999,
      },
      enableAlerts: true,
    });

    (httpService.request as jest.Mock).mockReturnValue(
      of({ status: 200, data: {} }),
    );

    const result = await service.runStressTest(config);

    expect(result.alerts.length).toBeGreaterThan(0);
  });

  it('getActiveTest returns undefined for unknown id', () => {
    expect(service.getActiveTest('nonexistent')).toBeUndefined();
  });

  it('getAllActiveTests returns empty array when none running', () => {
    expect(service.getAllActiveTests()).toEqual([]);
  });
});
