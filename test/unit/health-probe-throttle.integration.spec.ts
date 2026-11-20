import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';
import { CacheService } from '../../src/cache/cache.service';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { HorizonService } from '../../src/stellar/horizon.service';
import { SorobanHealthService } from '../../src/stellar/soroban-health.service';

describe('health probe throttle bypass', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }])],
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: { get: () => 'test' },
        },
        {
          provide: PrismaService,
          useValue: { escrow: { findMany: jest.fn().mockResolvedValue([]) } },
        },
        {
          provide: CacheService,
          useValue: { ping: jest.fn().mockResolvedValue('ok') },
        },
        {
          provide: HorizonService,
          useValue: {
            checkHealth: jest.fn().mockResolvedValue({ status: 'ok' }),
          },
        },
        {
          provide: SorobanHealthService,
          useValue: {
            checkHealth: jest.fn().mockResolvedValue({ status: 'ok' }),
          },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/health/live', '/health/ready'])(
    'allows requests beyond the global limit for %s',
    async (path) => {
      for (let requestNumber = 0; requestNumber < 4; requestNumber++) {
        await request(app.getHttpServer()).get(path).expect(200);
      }
    },
  );
});
