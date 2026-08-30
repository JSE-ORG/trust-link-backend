import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigService } from './config/config.service';
import { PrismaService } from './prisma/prisma.service';
import { CacheService } from './cache/cache.service';
import { HorizonService } from './stellar/horizon.service';

function createMockResponse() {
  const res: Partial<Response> & {
    statusCode?: number;
    body?: unknown;
  } = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  });
  return res as Response & { statusCode?: number; body?: unknown };
}

describe('AppController', () => {
  let appController: AppController;
  let fetchSpy: jest.SpyInstance | undefined;
  let escrowFindManyMock: jest.Mock;
  let cachePingMock: jest.Mock;

  beforeEach(async () => {
    escrowFindManyMock = jest.fn().mockResolvedValue([]);
    cachePingMock = jest.fn().mockResolvedValue('ok');

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, unknown> = {
          NODE_ENV: 'test',
          PORT: 3000,
          STELLAR_NETWORK: 'TESTNET',
        };
        return config[key];
      }),
    };

    const mockPrismaService = {
      escrow: {
        findMany: escrowFindManyMock,
      },
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CacheService, useValue: { ping: cachePingMock } },
        HorizonService,
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.mockRestore();
      fetchSpy = undefined;
    }
  });

  describe('root', () => {
    it('returns Hello World!', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health/live (liveness probe)', () => {
    it('always returns 200 with status ok, no dependency checks', () => {
      const live = appController.getLiveness();

      expect(live.status).toBe('ok');
      expect(live.environment).toBe('test');
      expect(typeof live.timestamp).toBe('string');
      expect(typeof live.version).toBe('string');
      // Liveness must NEVER expose durationMs, db/horizon/redis fields, etc.
      expect(Object.keys(live)).toEqual([
        'status',
        'timestamp',
        'environment',
        'version',
      ]);
    });

    it('returns 200 while the database is down (no restart loop)', async () => {
      // Simulate DB that has been completely unreachable for a while
      escrowFindManyMock.mockRejectedValue(
        new Error('pg connection refused (sustained outage)'),
      );
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('horizon also unreachable'));
      cachePingMock.mockResolvedValue('down');

      // Liveness returns 200 synchronously — no awaits, no network calls
      const live = appController.getLiveness();

      expect(live.status).toBe('ok');
      // Sanity-check that mocks still reflect the failed state (i.e. the
      // liveness endpoint really didn't try to run dependency checks).
      expect(escrowFindManyMock).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(cachePingMock).not.toHaveBeenCalled();
    });
  });

  describe('health/ready (readiness probe)', () => {
    it('returns 200 when db and horizon respond', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getReadiness(res);

      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'ok',
        db: 'ok',
        horizon: 'ok',
        redis: 'ok',
        environment: 'test',
      });
      expect(typeof body.durationMs).toBe('number');
    });

    /**
     * Regression guard for #563. The probe is polled by a load balancer on a
     * short interval, so the query has to stay bounded. `findMany({})` returns
     * every escrow row, which was cheap against the in-memory PrismaService
     * fake and is an unbounded `SELECT *` against the real client.
     */
    it('queries the database with a bounded query, not every escrow row', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getReadiness(res);

      expect(escrowFindManyMock).toHaveBeenCalledTimes(1);
      const args = escrowFindManyMock.mock.calls[0][0] as {
        take?: number;
        select?: Record<string, boolean>;
      };
      expect(args.take).toBe(1);
      expect(args.select).toEqual({ id: true });
    });

    it('returns 503 while the database is down', async () => {
      escrowFindManyMock.mockRejectedValue(new Error('connection refused'));
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getReadiness(res);

      expect(res.statusCode).toBe(503);
      const body = res.body as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'down',
        db: 'down',
        horizon: 'ok',
      });
      expect(body.details).toBeDefined();
      expect((body.details as Record<string, unknown>).db).toEqual({
        status: 'down',
        error: 'connection refused',
      });
    });

    it('redis disabled does NOT flip readiness to unhealthy', async () => {
      cachePingMock.mockResolvedValue('disabled');
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getReadiness(res);

      // Redis being off must not flip the overall status (graceful fallback).
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', redis: 'disabled' });
    });

    it('redis down does NOT flip readiness to unhealthy on its own', async () => {
      cachePingMock.mockResolvedValue('down');
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getReadiness(res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', redis: 'down' });
    });
  });

  describe('health (legacy alias)', () => {
    it('returns 200 with all components ok when db and horizon respond', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getHealth(res);

      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'ok',
        db: 'ok',
        horizon: 'ok',
        redis: 'ok',
        environment: 'test',
      });
      expect(typeof body.durationMs).toBe('number');
    });

    it('is an alias for /health/ready — same behaviour when db is down', async () => {
      escrowFindManyMock.mockRejectedValue(new Error('connection refused'));
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const healthAlias = createMockResponse();
      const readiness = createMockResponse();
      await appController.getHealth(healthAlias);
      await appController.getReadiness(readiness);

      // Legacy /health and /health/ready must agree on status code and body.
      expect(healthAlias.statusCode).toBe(readiness.statusCode);
      expect(healthAlias.statusCode).toBe(503);
      const hb = healthAlias.body as Record<string, unknown>;
      const rb = readiness.body as Record<string, unknown>;
      expect(hb.status).toBe(rb.status);
      expect(hb.db).toBe(rb.db);
      expect(hb.horizon).toBe(rb.horizon);
    });

    it('reports redis: disabled without making the service unhealthy', async () => {
      cachePingMock.mockResolvedValue('disabled');
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getHealth(res);

      // Redis being off must not flip the overall status (graceful fallback).
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', redis: 'disabled' });
    });

    it('reports redis: down without returning 503', async () => {
      cachePingMock.mockResolvedValue('down');
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getHealth(res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', redis: 'down' });
    });

    it('returns 503 with db: down when the database check fails', async () => {
      escrowFindManyMock.mockRejectedValue(new Error('connection refused'));
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getHealth(res);

      expect(res.statusCode).toBe(503);
      const body = res.body as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'down',
        db: 'down',
        horizon: 'ok',
      });
      expect(body.details).toBeDefined();
      expect((body.details as Record<string, unknown>).db).toEqual({
        status: 'down',
        error: 'connection refused',
      });
    });

    it('returns 503 with horizon: down when Horizon is unreachable', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('network timeout'));

      const res = createMockResponse();
      await appController.getHealth(res);

      expect(res.statusCode).toBe(503);
      const body = res.body as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'down',
        db: 'ok',
        horizon: 'down',
      });
      expect(body.details).toBeDefined();
      expect((body.details as Record<string, unknown>).horizon).toEqual({
        status: 'down',
        error: 'network timeout',
      });
    });

    it('returns 503 with horizon: down when Horizon responds non-2xx', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: false, status: 502 } as never);

      const res = createMockResponse();
      await appController.getHealth(res);

      expect(res.statusCode).toBe(503);
      const body = res.body as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'down',
        horizon: 'down',
      });
      expect(body.details).toBeDefined();
      expect((body.details as Record<string, unknown>).horizon).toEqual({
        status: 'down',
        error: 'Horizon returned status 502',
      });
    });
  });

  describe('version', () => {
    it('returns version metadata', () => {
      const version = appController.getVersion();
      expect(version.version).toBe('1.0.0');
      expect(version.environment).toBe('test');
    });
  });
});
