import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigService } from './config/config.service';
import { PrismaService } from './prisma/prisma.service';

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

  beforeEach(async () => {
    escrowFindManyMock = jest.fn().mockResolvedValue([]);

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

  describe('health', () => {
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
        environment: 'test',
      });
      expect(typeof body.durationMs).toBe('number');
    });

    it('returns 503 with db: down when the database check fails', async () => {
      escrowFindManyMock.mockRejectedValue(new Error('connection refused'));
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true } as never);

      const res = createMockResponse();
      await appController.getHealth(res);

      expect(res.statusCode).toBe(503);
      expect(res.body).toMatchObject({
        status: 'down',
        db: 'down',
        horizon: 'ok',
      });
    });

    it('returns 503 with horizon: down when Horizon is unreachable', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('network timeout'));

      const res = createMockResponse();
      await appController.getHealth(res);

      expect(res.statusCode).toBe(503);
      expect(res.body).toMatchObject({
        status: 'down',
        db: 'ok',
        horizon: 'down',
      });
    });

    it('returns 503 with horizon: down when Horizon responds non-2xx', async () => {
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: false, status: 502 } as never);

      const res = createMockResponse();
      await appController.getHealth(res);

      expect(res.statusCode).toBe(503);
      expect(res.body).toMatchObject({
        status: 'down',
        horizon: 'down',
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
