/**
 * Controller-level tests for POST /stress-test and the active-test read
 * endpoints (issue #576).
 *
 * `StressTestController` guards every route with JwtGuard + AdminGuard, and
 * was previously covered only indirectly through `StressTestService`
 * (#400). These tests use the real guards (as `api-keys.controller.spec.ts`
 * does) so a future refactor that accidentally drops `@UseGuards` fails
 * here, and mock `StressTestService` entirely so no load is ever actually
 * generated.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { StressTestController } from '../../src/stress-test/stress-test.controller';
import { StressTestService } from '../../src/stress-test/stress-test.service';
import { JwtGuard } from '../../src/auth/guards/jwt.guard';
import { AdminGuard } from '../../src/admin/guards/admin.guard';
import { ConfigService } from '../../src/config/config.service';
import { StressTestResult } from '../../src/stress-test/interfaces/stress-test-result.interface';
import { bearer } from '../auth-helper';

describe('StressTestController (issue #576)', () => {
  let app: INestApplication;
  let stressTestService: jest.Mocked<StressTestService>;

  // Deliberately a real Stellar-format address that is not
  // process.env.ADMIN_ADDRESS, so the non-admin case exercises AdminGuard's
  // address comparison rather than JwtGuard rejecting an unparseable value.
  const NON_ADMIN_ADDRESS =
    'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

  const sampleResult: StressTestResult = {
    testId: 'stress-test-1',
    testName: 'escrow-create-peak-load',
    startTime: 1735689600000,
    endTime: 1735689660000,
    duration: 60000,
    profileResults: [],
    overallMetrics: {
      totalRequests: 100,
      successfulRequests: 100,
      failedRequests: 0,
      averageResponseTime: 42,
      overallErrorRate: 0,
      overallThroughput: 10,
    },
    alerts: [],
    status: 'COMPLETED',
  };

  const validConfig = {
    testName: 'escrow-create-peak-load',
    profiles: [
      {
        concurrentUsers: 10,
        requestsPerSecond: 5,
        duration: 10,
        endpoint: '/api/escrows',
      },
    ],
  };

  beforeEach(async () => {
    stressTestService = {
      runStressTest: jest.fn(),
      getActiveTest: jest.fn(),
      getAllActiveTests: jest.fn(),
    } as unknown as jest.Mocked<StressTestService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [StressTestController],
      providers: [
        { provide: StressTestService, useValue: stressTestService },
        JwtGuard,
        AdminGuard,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => process.env[key]) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('authentication and authorization', () => {
    it('rejects POST /stress-test with no Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/stress-test')
        .send(validConfig)
        .expect(401);

      expect(stressTestService.runStressTest).not.toHaveBeenCalled();
    });

    it('rejects POST /stress-test for a non-admin caller', async () => {
      await request(app.getHttpServer())
        .post('/stress-test')
        .set('Authorization', bearer(NON_ADMIN_ADDRESS))
        .send(validConfig)
        .expect(403);

      expect(stressTestService.runStressTest).not.toHaveBeenCalled();
    });

    it('rejects GET /stress-test/active with no Authorization header', async () => {
      await request(app.getHttpServer()).get('/stress-test/active').expect(401);

      expect(stressTestService.getAllActiveTests).not.toHaveBeenCalled();
    });

    it('rejects GET /stress-test/active for a non-admin caller', async () => {
      await request(app.getHttpServer())
        .get('/stress-test/active')
        .set('Authorization', bearer(NON_ADMIN_ADDRESS))
        .expect(403);

      expect(stressTestService.getAllActiveTests).not.toHaveBeenCalled();
    });

    it('rejects GET /stress-test/active/:testId with no Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/stress-test/active/stress-test-1')
        .expect(401);

      expect(stressTestService.getActiveTest).not.toHaveBeenCalled();
    });

    it('rejects GET /stress-test/active/:testId for a non-admin caller', async () => {
      await request(app.getHttpServer())
        .get('/stress-test/active/stress-test-1')
        .set('Authorization', bearer(NON_ADMIN_ADDRESS))
        .expect(403);

      expect(stressTestService.getActiveTest).not.toHaveBeenCalled();
    });
  });

  describe('POST /stress-test', () => {
    it('starts a run for an admin caller with a valid config', async () => {
      stressTestService.runStressTest.mockResolvedValue(sampleResult);

      const res = await request(app.getHttpServer())
        .post('/stress-test')
        .set('Authorization', bearer(process.env.ADMIN_ADDRESS!))
        .send(validConfig)
        .expect(201);

      expect(stressTestService.runStressTest).toHaveBeenCalledTimes(1);
      expect(res.body.testId).toBe('stress-test-1');
    });

    it('returns 400 rather than starting a run when profiles is not an array', async () => {
      await request(app.getHttpServer())
        .post('/stress-test')
        .set('Authorization', bearer(process.env.ADMIN_ADDRESS!))
        .send({ testName: 'bad-config', profiles: 'not-an-array' })
        .expect(400);

      expect(stressTestService.runStressTest).not.toHaveBeenCalled();
    });

    it('returns 400 when required fields are missing entirely', async () => {
      await request(app.getHttpServer())
        .post('/stress-test')
        .set('Authorization', bearer(process.env.ADMIN_ADDRESS!))
        .send({})
        .expect(400);

      expect(stressTestService.runStressTest).not.toHaveBeenCalled();
    });
  });

  describe('GET /stress-test/active/:testId', () => {
    it('delegates to the service for an admin caller', async () => {
      stressTestService.getActiveTest.mockReturnValue(sampleResult);

      const res = await request(app.getHttpServer())
        .get('/stress-test/active/stress-test-1')
        .set('Authorization', bearer(process.env.ADMIN_ADDRESS!))
        .expect(200);

      expect(stressTestService.getActiveTest).toHaveBeenCalledWith(
        'stress-test-1',
      );
      expect(res.body.testId).toBe('stress-test-1');
    });
  });

  describe('GET /stress-test/active', () => {
    it('delegates to the service for an admin caller', async () => {
      stressTestService.getAllActiveTests.mockReturnValue([sampleResult]);

      const res = await request(app.getHttpServer())
        .get('/stress-test/active')
        .set('Authorization', bearer(process.env.ADMIN_ADDRESS!))
        .expect(200);

      expect(stressTestService.getAllActiveTests).toHaveBeenCalledTimes(1);
      expect(res.body).toHaveLength(1);
    });
  });
});
