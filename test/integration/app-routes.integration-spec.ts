/**
 * Integration tests for GET /health/live, GET /health/ready and GET /version
 * (issue #800).
 *
 * GET /health already has coverage in health.integration-spec.ts. These three
 * routes did not: readiness is the one that matters most, since it's what a
 * deployment platform polls before sending traffic — if it reports ready
 * while the database is unreachable, a bad deploy goes live.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CacheService } from '../../src/cache/cache.service';
import { HorizonService } from '../../src/stellar/horizon.service';
import { SorobanHealthService } from '../../src/stellar/soroban-health.service';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('App-level routes (issue #800)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'NODE_ENV':
          return 'test';
        case 'STELLAR_NETWORK':
          return 'TESTNET';
        default:
          return undefined;
      }
    }),
  } as unknown as ConfigService;

  let cachePingMock: jest.Mock;

  beforeEach(async () => {
    mockFetch.mockResolvedValue({ ok: true });
    cachePingMock = jest.fn().mockResolvedValue('ok');

    prisma = new PrismaService();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: { ping: cachePingMock } },
        HorizonService,
        SorobanHealthService,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    await prisma.reset();
  });

  afterEach(async () => {
    await app.close();
    mockFetch.mockReset();
  });

  // ─── GET /health/live ───────────────────────────────────────────────────

  describe('GET /health/live', () => {
    it('returns HTTP 200 with the liveness shape', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health/live')
        .expect(200);

      expect(body).toEqual({
        status: 'ok',
        timestamp: expect.any(String),
        environment: 'test',
        version: expect.any(String),
      });
    });

    it('never touches the database, Horizon or Redis', async () => {
      jest
        .spyOn(prisma.escrow, 'findMany')
        .mockRejectedValue(new Error('ECONNREFUSED'));
      mockFetch.mockRejectedValue(new Error('fetch failed'));
      cachePingMock.mockRejectedValue(new Error('Redis down'));

      // Every dependency is broken, yet liveness must still report ok — it
      // exists precisely so a transient external outage doesn't trigger a
      // container restart loop.
      await request(app.getHttpServer()).get('/health/live').expect(200);

      expect(prisma.escrow.findMany).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(cachePingMock).not.toHaveBeenCalled();
    });
  });

  // ─── GET /health/ready ──────────────────────────────────────────────────

  describe('GET /health/ready', () => {
    it('returns HTTP 200 with all statuses ok when every dependency is reachable', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(body.status).toBe('ok');
      expect(body.db).toBe('ok');
      expect(body.horizon).toBe('ok');
      expect(body.soroban).toBe('ok');
    });

    it('returns HTTP 503 and status: "down" when the database is unreachable', async () => {
      jest
        .spyOn(prisma.escrow, 'findMany')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { body } = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503);

      expect(body.status).toBe('down');
      expect(body.db).toBe('down');
      expect(body.details.db.error).toContain('ECONNREFUSED');
    });

    it('returns HTTP 503 when Horizon is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const { body } = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503);

      expect(body.status).toBe('down');
      expect(body.horizon).toBe('down');
    });

    it('is not affected by Redis being down (Redis is optional)', async () => {
      cachePingMock.mockResolvedValue('down');

      const { body } = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(body.status).toBe('ok');
      expect(body.redis).toBe('down');
    });
  });

  // ─── GET /version ───────────────────────────────────────────────────────

  describe('GET /version', () => {
    it('returns HTTP 200 with version, name and environment', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/version')
        .expect(200);

      expect(body).toEqual({
        version: expect.any(String),
        name: '@truestlink/trustlink-backend',
        environment: 'test',
      });
    });

    it('does not depend on the database, Horizon or Redis', async () => {
      jest
        .spyOn(prisma.escrow, 'findMany')
        .mockRejectedValue(new Error('ECONNREFUSED'));
      mockFetch.mockRejectedValue(new Error('fetch failed'));

      await request(app.getHttpServer()).get('/version').expect(200);
    });
  });
});
