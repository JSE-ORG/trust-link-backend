import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CacheService } from '../../src/cache/cache.service';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('GET /health integration (issue #55)', () => {
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

  // ─── Happy path ───────────────────────────────────────────────────────────

  describe('when all dependencies are reachable', () => {
    it('returns HTTP 200', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
    });

    it('returns the exact HealthBody JSON shape', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body).toEqual(
        expect.objectContaining({
          status: expect.stringMatching(/^(ok|down)$/),
          db: expect.stringMatching(/^(ok|down)$/),
          horizon: expect.stringMatching(/^(ok|down)$/),
          timestamp: expect.any(String),
          environment: expect.any(String),
          version: expect.any(String),
          durationMs: expect.any(Number),
        }),
      );
    });

    it('status is "ok" when both db and horizon are healthy', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.status).toBe('ok');
      expect(body.db).toBe('ok');
      expect(body.horizon).toBe('ok');
    });

    it('contains no extra undocumented top-level keys', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      const allowedKeys = new Set([
        'status',
        'db',
        'horizon',
        'redis',
        'timestamp',
        'environment',
        'version',
        'durationMs',
      ]);
      const unexpected = Object.keys(body).filter((k) => !allowedKeys.has(k));
      expect(unexpected).toHaveLength(0);
    });

    it('timestamp is a valid ISO-8601 string', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    it('durationMs is a non-negative integer', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(body.durationMs)).toBe(true);
    });

    it('environment matches NODE_ENV="test"', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.environment).toBe('test');
    });

    it('version field is a semver string', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  // ─── Database downtime ────────────────────────────────────────────────────

  describe('when the database is down', () => {
    it('returns HTTP 503', async () => {
      jest
        .spyOn(prisma.escrow, 'findMany')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await request(app.getHttpServer()).get('/health').expect(503);
    });

    it('sets status: "down" and db: "down"', async () => {
      jest
        .spyOn(prisma.escrow, 'findMany')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(body.status).toBe('down');
      expect(body.db).toBe('down');
    });

    it('still returns all required fields when db is down', async () => {
      jest
        .spyOn(prisma.escrow, 'findMany')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(body).toEqual(
        expect.objectContaining({
          status: 'down',
          db: 'down',
          horizon: expect.stringMatching(/^(ok|down)$/),
          timestamp: expect.any(String),
          environment: expect.any(String),
          version: expect.any(String),
          durationMs: expect.any(Number),
        }),
      );
    });
  });

  // ─── Horizon downtime ─────────────────────────────────────────────────────

  describe('when Horizon is unreachable', () => {
    it('returns HTTP 503 when fetch throws a network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      await request(app.getHttpServer()).get('/health').expect(503);
    });

    it('sets status: "down" and horizon: "down" on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(body.status).toBe('down');
      expect(body.horizon).toBe('down');
    });

    it('returns HTTP 503 when Horizon responds with a non-2xx status', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      await request(app.getHttpServer()).get('/health').expect(503);
    });

    it('sets horizon: "down" when Horizon responds non-2xx', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(body.horizon).toBe('down');
    });

    it('still returns all required fields when horizon is down', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(body).toEqual(
        expect.objectContaining({
          status: 'down',
          db: expect.stringMatching(/^(ok|down)$/),
          horizon: 'down',
          timestamp: expect.any(String),
          environment: expect.any(String),
          version: expect.any(String),
          durationMs: expect.any(Number),
        }),
      );
    });
  });

  // ─── Both dependencies down ───────────────────────────────────────────────

  describe('when both db and Horizon are down simultaneously', () => {
    it('returns HTTP 503 with status, db, and horizon all "down"', async () => {
      jest
        .spyOn(prisma.escrow, 'findMany')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(body.status).toBe('down');
      expect(body.db).toBe('down');
      expect(body.horizon).toBe('down');
    });
  });

  // ─── Redis downtime ───────────────────────────────────────────────────────

  describe('when Redis is down', () => {
    it('returns HTTP 200 (Redis is optional — graceful fallback)', async () => {
      cachePingMock.mockResolvedValue('down');

      await request(app.getHttpServer()).get('/health').expect(200);
    });

    it('sets redis: "down" without making the service unhealthy', async () => {
      cachePingMock.mockResolvedValue('down');

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.status).toBe('ok');
      expect(body.redis).toBe('down');
    });

    it('reports redis: "disabled" when Redis is not configured', async () => {
      cachePingMock.mockResolvedValue('disabled');

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.status).toBe('ok');
      expect(body.redis).toBe('disabled');
    });

    it('handles Redis ping throwing an unexpected error gracefully', async () => {
      cachePingMock.mockRejectedValue(new Error('Redis connection lost'));

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.status).toBe('ok');
      expect(body.redis).toBe('down');
    });
  });

  // ─── All components healthy ───────────────────────────────────────────────

  describe('when all dependencies including Redis are reachable', () => {
    it('returns HTTP 200 with all statuses ok', async () => {
      cachePingMock.mockResolvedValue('ok');

      const { body } = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(body.status).toBe('ok');
      expect(body.db).toBe('ok');
      expect(body.horizon).toBe('ok');
      expect(body.redis).toBe('ok');
    });
  });
});
