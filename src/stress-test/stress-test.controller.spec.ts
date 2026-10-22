/**
 * Tests for StressTestController covering:
 * - DTO validation bounds on StressTestConfigDto / VirtualProfile (issue #1056)
 * - GET /stress-test/active/:testId returns 404 for an unknown id (issue #1056)
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NotFoundException } from '@nestjs/common';
import { StressTestController } from './stress-test.controller';
import { StressTestService } from './stress-test.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  StressTestConfigDto,
  VirtualProfile,
} from './dto/stress-test-config.dto';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<VirtualProfile> = {}): VirtualProfile {
  return plainToInstance(VirtualProfile, {
    concurrentUsers: 10,
    requestsPerSecond: 50,
    duration: 60,
    endpoint: '/api/escrows',
    method: 'GET',
    ...overrides,
  });
}

function makeConfig(
  overrides: Partial<StressTestConfigDto> = {},
): StressTestConfigDto {
  return plainToInstance(StressTestConfigDto, {
    testName: 'test-run',
    profiles: [makeProfile()],
    ...overrides,
  });
}

async function validationErrors(dto: object): Promise<string[]> {
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

// ── DTO Validation ────────────────────────────────────────────────────────────

describe('StressTestConfigDto validation', () => {
  it('accepts a valid config', async () => {
    const errors = await validationErrors(makeConfig());
    expect(errors).toHaveLength(0);
  });

  describe('VirtualProfile.requestsPerSecond', () => {
    it('rejects 0 (below minimum of 1)', async () => {
      const profile = makeProfile({ requestsPerSecond: 0 });
      const errors = await validationErrors(profile);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects 1001 (above maximum of 1000)', async () => {
      const profile = makeProfile({ requestsPerSecond: 1001 });
      const errors = await validationErrors(profile);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts boundary value 1000', async () => {
      const errors = await validationErrors(
        makeProfile({ requestsPerSecond: 1000 }),
      );
      expect(errors).toHaveLength(0);
    });
  });

  describe('VirtualProfile.duration', () => {
    it('rejects 0 (below minimum of 1)', async () => {
      const profile = makeProfile({ duration: 0 });
      const errors = await validationErrors(profile);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects 3601 (above maximum of 3600)', async () => {
      const profile = makeProfile({ duration: 3601 });
      const errors = await validationErrors(profile);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts boundary value 3600', async () => {
      const errors = await validationErrors(makeProfile({ duration: 3600 }));
      expect(errors).toHaveLength(0);
    });
  });

  describe('VirtualProfile.endpoint', () => {
    it('rejects an endpoint containing a scheme (https://)', async () => {
      const profile = makeProfile({ endpoint: 'https://evil.com/steal' });
      const errors = await validationErrors(profile);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects an endpoint containing @', async () => {
      const profile = makeProfile({ endpoint: '/api/@admin' });
      const errors = await validationErrors(profile);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects an endpoint that does not start with /', async () => {
      const profile = makeProfile({ endpoint: 'api/escrows' });
      const errors = await validationErrors(profile);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts a valid path', async () => {
      const errors = await validationErrors(
        makeProfile({ endpoint: '/api/escrows/1' }),
      );
      expect(errors).toHaveLength(0);
    });
  });

  describe('VirtualProfile.method', () => {
    it('rejects an unknown HTTP method', async () => {
      const profile = makeProfile({ method: 'TRACE' as never });
      const errors = await validationErrors(profile);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts all allowed methods', async () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
      for (const method of methods) {
        const errors = await validationErrors(makeProfile({ method }));
        expect(errors).toHaveLength(0);
      }
    });
  });

  describe('StressTestConfigDto.profiles', () => {
    it('rejects more than 10 profiles', async () => {
      const profiles = Array.from({ length: 11 }, () => makeProfile());
      const config = makeConfig({ profiles });
      const errors = await validationErrors(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts exactly 10 profiles', async () => {
      const profiles = Array.from({ length: 10 }, () => makeProfile());
      const errors = await validationErrors(makeConfig({ profiles }));
      expect(errors).toHaveLength(0);
    });
  });
});

// ── Controller — 404 for unknown testId ──────────────────────────────────────

describe('StressTestController.getActiveTest', () => {
  let controller: StressTestController;
  let stressTestService: jest.Mocked<Pick<StressTestService, 'getActiveTest'>>;

  beforeEach(() => {
    stressTestService = { getActiveTest: jest.fn() };
    const auditLog = { append: jest.fn() } as unknown as AuditLogService;
    controller = new StressTestController(
      stressTestService as unknown as StressTestService,
      auditLog,
    );
  });

  it('throws NotFoundException when the test id is not found', () => {
    stressTestService.getActiveTest.mockReturnValue(undefined);
    expect(() => controller.getActiveTest('nonexistent-id')).toThrow(
      NotFoundException,
    );
  });

  it('returns the result when the test id exists', () => {
    const result = { testId: 'abc', status: 'running' } as never;
    stressTestService.getActiveTest.mockReturnValue(result);
    expect(controller.getActiveTest('abc')).toBe(result);
  });
});
