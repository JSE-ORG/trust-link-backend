import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Express } from 'express';
import request from 'supertest';
import { THROTTLE_WINDOW_MS } from '../../src/common/security/throttle.config';
import { parseTrustProxy } from '../../src/common/security/trust-proxy.config';

/**
 * Issue #971 — behind a load balancer every client shares one rate limit,
 * because req.ip is the balancer's address. These tests check that setting
 * `trust proxy` makes the limit follow the forwarded client IP instead.
 */
@Controller('trust-proxy-probe')
class TrustProxyProbeController {
  @Get()
  @Throttle({ public: { limit: 2, ttl: THROTTLE_WINDOW_MS } })
  probe() {
    return { ok: true };
  }
}

async function buildApp(trustProxy?: string): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot([{ name: 'public', ttl: 60000, limit: 2 }]),
    ],
    controllers: [TrustProxyProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();

  const app = moduleRef.createNestApplication();
  if (trustProxy !== undefined) {
    const setting = parseTrustProxy(trustProxy);
    if (setting === null) {
      throw new Error(`test setup: invalid TRUST_PROXY "${trustProxy}"`);
    }
    (app.getHttpAdapter().getInstance() as Express).set(
      'trust proxy',
      setting,
    );
  }
  await app.init();
  return app;
}

describe('TRUST_PROXY rate limiting (issue #971)', () => {
  describe('with TRUST_PROXY=1', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await buildApp('1');
    });

    afterAll(async () => {
      await app.close();
    });

    it('throttles two forwarded client IPs separately', async () => {
      const server = app.getHttpServer();
      const clientA = { 'X-Forwarded-For': '203.0.113.10' };
      const clientB = { 'X-Forwarded-For': '203.0.113.20' };

      await request(server).get('/trust-proxy-probe').set(clientA).expect(200);
      await request(server).get('/trust-proxy-probe').set(clientA).expect(200);
      await request(server).get('/trust-proxy-probe').set(clientA).expect(429);

      // Client B has its own bucket and is not blocked by client A's usage.
      await request(server).get('/trust-proxy-probe').set(clientB).expect(200);
    });
  });

  describe('without TRUST_PROXY', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await buildApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('ignores X-Forwarded-For, so differing headers share one bucket', async () => {
      const server = app.getHttpServer();

      await request(server)
        .get('/trust-proxy-probe')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect(200);
      await request(server)
        .get('/trust-proxy-probe')
        .set('X-Forwarded-For', '203.0.113.20')
        .expect(200);
      await request(server)
        .get('/trust-proxy-probe')
        .set('X-Forwarded-For', '203.0.113.30')
        .expect(429);
    });
  });
});
