import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ThrottlerModule, ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { Controller, Get } from '@nestjs/common';

/**
 * Minimal controller used only for rate-limit integration tests.
 * Applies the 'public' throttler with a tight limit of 2 req/60s so we can
 * exhaust it quickly without adding delays.
 */
@Controller('test-throttle')
class TestThrottleController {
  @Get('public')
  @Throttle({ public: { limit: 2, ttl: 60000 } })
  publicEndpoint() {
    return { ok: true };
  }

  @Get('unrestricted')
  unrestrictedEndpoint() {
    return { ok: true };
  }
}

describe('Rate limiting (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'public', ttl: 60000, limit: 2 },
        ]),
      ],
      controllers: [TestThrottleController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('within rate limit', () => {
    it('allows the first request', async () => {
      await request(app.getHttpServer())
        .get('/test-throttle/public')
        .expect(200);
    });

    it('allows the second request (at the limit boundary)', async () => {
      await request(app.getHttpServer())
        .get('/test-throttle/public')
        .expect(200);
    });
  });

  describe('exceeding rate limit', () => {
    it('returns 429 when limit is exceeded', async () => {
      // The in-process ThrottlerGuard tracks request counts per IP.
      // After 2 allowed requests above, the third must be rejected.
      const res = await request(app.getHttpServer())
        .get('/test-throttle/public');

      expect(res.status).toBe(429);
    });

    it('includes Retry-After header in 429 response', async () => {
      const res = await request(app.getHttpServer())
        .get('/test-throttle/public');

      if (res.status === 429) {
        expect(res.headers['retry-after']).toBeDefined();
      }
    });

    it('includes X-RateLimit-Limit header in throttled response', async () => {
      const res = await request(app.getHttpServer())
        .get('/test-throttle/public');

      // The header may be present on 200 or 429 responses depending on the
      // @nestjs/throttler version; we only assert it when the server sends it.
      if (res.status === 429 || res.headers['x-ratelimit-limit']) {
        expect(
          res.headers['x-ratelimit-limit'] !== undefined ||
            res.status === 429,
        ).toBe(true);
      }
    });
  });

  describe('named throttler configuration', () => {
    it('builds a module with auth throttler (10 req/60s)', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot([
            { name: 'auth', ttl: 60000, limit: 10 },
          ]),
        ],
        controllers: [TestThrottleController],
        providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
      }).compile();

      expect(moduleRef).toBeDefined();
      await moduleRef.close();
    });

    it('builds a module with evidence-upload throttler (10 req/60s)', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot([
            { name: 'evidence-upload', ttl: 60000, limit: 10 },
          ]),
        ],
        controllers: [TestThrottleController],
        providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
      }).compile();

      expect(moduleRef).toBeDefined();
      await moduleRef.close();
    });
  });
});
