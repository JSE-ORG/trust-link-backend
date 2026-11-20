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
