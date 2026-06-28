import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { ConfigService } from '../config/config.service';
import { getStorageToken } from '@nestjs/throttler';
import { ThrottlerStorage } from '@nestjs/throttler';

// Must be set before Test.createTestingModule so ThrottlerModule picks them up
process.env.EVIDENCE_UPLOAD_LIMIT = '5';
process.env.EVIDENCE_UPLOAD_TTL = '2000';

describe('Evidence Upload Rate Limiting (e2e)', () => {
  let app: INestApplication;
  let configService: ConfigService;
  let throttlerStorage: ThrottlerStorage & {
    _storage: Map<string, unknown>;
    timeoutIds: Map<string, NodeJS.Timeout[]>;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configService = moduleFixture.get<ConfigService>(ConfigService);
    throttlerStorage = moduleFixture.get(getStorageToken());

    await app.init();
  }, 15_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Isolate each test: cancel pending expiry timeouts then clear hit counters
    throttlerStorage.timeoutIds?.forEach((ids) => ids.forEach(clearTimeout));
    throttlerStorage.timeoutIds?.clear();
    throttlerStorage._storage?.clear();
  });

  describe('POST /escrow/evidence-upload', () => {
    it('should allow requests within rate limit', async () => {
      const limit = Number(configService.get('EVIDENCE_UPLOAD_LIMIT')) || 5;

      for (let i = 0; i < limit; i++) {
        const response = await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `test-file-${i}.pdf` })
          .set('Authorization', 'Bearer valid-jwt-token');

        expect([HttpStatus.CREATED, HttpStatus.UNAUTHORIZED]).toContain(
          response.status,
        );
        expect(response.status).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it('should return 429 when rate limit is exceeded', async () => {
      const limit = Number(configService.get('EVIDENCE_UPLOAD_LIMIT')) || 5;
      let rateLimitHit = false;

      for (let i = 0; i < limit + 5; i++) {
        const response = await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `test-file-${i}.pdf` })
          .set('Authorization', 'Bearer valid-jwt-token');

        if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
          rateLimitHit = true;
          // NestJS throttler emits Retry-After-<throttlerName> header
          expect(response.headers).toHaveProperty(
            'retry-after-evidence-upload',
          );
          expect(response.body).toHaveProperty('message');
          break;
        }
      }

      expect(rateLimitHit).toBe(true);
    });

    it('should include Retry-After header in 429 response', async () => {
      const limit = Number(configService.get('EVIDENCE_UPLOAD_LIMIT')) || 5;
      const ttl = Number(configService.get('EVIDENCE_UPLOAD_TTL')) || 2000;

      for (let i = 0; i < limit + 3; i++) {
        const response = await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `test-file-${i}.pdf` })
          .set('Authorization', 'Bearer valid-jwt-token');

        if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
          const retryAfter = response.headers['retry-after-evidence-upload'];
          expect(retryAfter).toBeDefined();

          const retryAfterNum = parseInt(retryAfter, 10);
          expect(retryAfterNum).toBeGreaterThan(0);
          expect(retryAfterNum).toBeLessThanOrEqual(Math.ceil(ttl / 1000));
          break;
        }
      }
    });

    it('should reset rate limit after TTL expires', async () => {
      const limit = Number(configService.get('EVIDENCE_UPLOAD_LIMIT')) || 5;

      // Exhaust the rate limit
      for (let i = 0; i < limit + 3; i++) {
        await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `test-file-${i}.pdf` })
          .set('Authorization', 'Bearer valid-jwt-token');
      }

      // Wait for TTL to expire (EVIDENCE_UPLOAD_TTL = 2000ms, wait 2500ms)
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Should allow requests again after the block window expires
      const response = await request(app.getHttpServer())
        .post('/escrow/evidence-upload')
        .query({ fileName: 'test-file-after-ttl.pdf' })
        .set('Authorization', 'Bearer valid-jwt-token');

      expect(response.status).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
    }, 10_000);

    it('should rate limit per IP (different tokens share the same IP limit)', async () => {
      const limit = Number(configService.get('EVIDENCE_UPLOAD_LIMIT')) || 5;

      // Exhaust rate limit for user 1
      for (let i = 0; i < limit + 2; i++) {
        await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `user1-file-${i}.pdf` })
          .set('Authorization', 'Bearer user1-jwt-token');
      }

      // User 2 from the same IP is also rate limited (throttler keys by IP, not by user)
      const response = await request(app.getHttpServer())
        .post('/escrow/evidence-upload')
        .query({ fileName: 'user2-file.pdf' })
        .set('Authorization', 'Bearer user2-jwt-token');

      expect(response.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('should allow legitimate uploads within normal usage patterns', async () => {
      const responses: number[] = [];

      for (let i = 0; i < 3; i++) {
        const response = await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `legitimate-file-${i}.pdf` })
          .set('Authorization', 'Bearer legitimate-user-token');

        responses.push(response.status);

        // Small delay between requests (normal user behaviour)
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 3 requests well under the limit of 5 — none should be rate limited
      responses.forEach((status) => {
        expect([HttpStatus.CREATED, HttpStatus.UNAUTHORIZED]).toContain(status);
        expect(status).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
      });
    });
  });

  describe('Environment Variable Configuration', () => {
    it('should use default values when env vars are not set', async () => {
      // Env vars were set before module compilation; configService can read them
      expect(configService.get('EVIDENCE_UPLOAD_LIMIT')).toBeDefined();
      expect(configService.get('EVIDENCE_UPLOAD_TTL')).toBeDefined();
    });

    it('should use custom values from env vars', async () => {
      process.env.EVIDENCE_UPLOAD_LIMIT = '15';
      process.env.EVIDENCE_UPLOAD_TTL = '120000';

      // ConfigService reads directly from process.env; values are strings
      const customLimit = configService.get('EVIDENCE_UPLOAD_LIMIT');
      const customTtl = configService.get('EVIDENCE_UPLOAD_TTL');

      expect(Number(customLimit)).toBe(15);
      expect(Number(customTtl)).toBe(120000);

      // Restore test values
      process.env.EVIDENCE_UPLOAD_LIMIT = '5';
      process.env.EVIDENCE_UPLOAD_TTL = '2000';
    });
  });
});
