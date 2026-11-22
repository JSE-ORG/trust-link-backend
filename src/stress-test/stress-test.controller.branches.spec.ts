/**
 * Tests for StressTestController branches (issue #1127).
 *
 * Covers: runStressTest when auditLog is absent (skips audit),
 * getActiveTest when test not found (throws NotFoundException).
 */

import { NotFoundException } from '@nestjs/common';
import { StressTestController } from './stress-test.controller';
import { StressTestService } from './stress-test.service';

function makeStressTestResult(testId: string) {
  return {
    testId,
    testName: 'test',
    startTime: Date.now(),
    endTime: Date.now(),
    duration: 0,
    profileResults: [],
    overallMetrics: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      overallErrorRate: 0,
      overallThroughput: 0,
    },
    alerts: [],
    status: 'COMPLETED' as const,
  };
}

describe('StressTestController.runStressTest', () => {
  it('skips audit log call when auditLog dependency is absent', async () => {
    const testId = 'test-id-1';
    const service = {
      generateTestId: jest.fn().mockReturnValue(testId),
      runStressTest: jest.fn().mockResolvedValue(makeStressTestResult(testId)),
    } as unknown as jest.Mocked<StressTestService>;

    // No auditLog injected
    const controller = new StressTestController(service, undefined);
    const config = { testName: 'run', profiles: [] } as never;
    const result = await controller.runStressTest(config, {
      address: 'ADMIN',
    });

    expect(result.testId).toBe(testId);
    expect(service.runStressTest).toHaveBeenCalledWith(config, testId);
  });
});

describe('StressTestController.getActiveTest', () => {
  it('throws NotFoundException when the test id is not in activeTests', () => {
    const service = {
      generateTestId: jest.fn().mockReturnValue('x'),
      getActiveTest: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<StressTestService>;

    const controller = new StressTestController(service, undefined);
    expect(() => controller.getActiveTest('missing')).toThrow(
      NotFoundException,
    );
  });
});

describe('StressTestController.runStressTest audit details (issue #1227)', () => {
  function makeController() {
    const testId = 'test-id-audit';
    const service = {
      generateTestId: jest.fn().mockReturnValue(testId),
      runStressTest: jest.fn().mockResolvedValue(makeStressTestResult(testId)),
    } as unknown as jest.Mocked<StressTestService>;
    const auditLog = { append: jest.fn().mockResolvedValue(undefined) };
    const controller = new StressTestController(service, auditLog as never);
    return { controller, service, auditLog, testId };
  }

  it('audits as "unknown" when the request carries no admin', async () => {
    const { controller, auditLog, testId } = makeController();

    await controller.runStressTest({ testName: 'run', profiles: [] });

    expect(auditLog.append).toHaveBeenCalledWith({
      action: 'STRESS_TEST_STARTED',
      adminAddress: 'unknown',
      entityType: 'stress_test',
      entityId: testId,
      details: { testName: 'run', profileCount: 0 },
    });
  });

  it('records a profile count of 0 when the config has no profiles', async () => {
    const { controller, service, auditLog, testId } = makeController();
    const config = { testName: 'no-profiles' } as never;

    await controller.runStressTest(config, { address: 'GADMIN' });

    expect(auditLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        adminAddress: 'GADMIN',
        details: { testName: 'no-profiles', profileCount: 0 },
      }),
    );
    expect(service.runStressTest).toHaveBeenCalledWith(config, testId);
  });

  it('records the real profile count when profiles are present', async () => {
    const { controller, auditLog } = makeController();

    await controller.runStressTest(
      { testName: 'two', profiles: [{}, {}] } as never,
      { address: 'GADMIN' },
    );

    expect(auditLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { testName: 'two', profileCount: 2 },
      }),
    );
  });
});
