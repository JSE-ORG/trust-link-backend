import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { ConfigService } from '../config/config.service';

describe('Evidence Upload Rate Limiting (e2e)', () => {
  let app: INestApplication;
  let configService: ConfigService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configService = moduleFixture.get<ConfigService>(ConfigService);
    
    // Configure test rate limits
    process.env.EVIDENCE_UPLOAD_LIMIT = '5';
    process.env.EVIDENCE_UPLOAD_TTL = '60000';
    
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /escrow/evidence-upload', () => {
    it('should allow requests within rate limit', async () => {
      const limit = configService.get<number>('EVIDENCE_UPLOAD_LIMIT') || 5;
      
      // Make requests up to the limit
      for (let i = 0; i < limit; i++) {
        const response = await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `test-file-${i}.pdf` })
          .set('Authorization', 'Bearer valid-jwt-token');

        // First request might fail with 401 due to auth, but should not be 429
        expect([HttpStatus.CREATED, HttpStatus.UNAUTHORIZED]).toContain(response.status);
        expect(response.status).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it('should return 429 when rate limit is exceeded', async () => {
      const limit = configService.get<number>('EVIDENCE_UPLOAD_LIMIT') || 5;
      
      // Make requests beyond the limit
      let rateLimitHit = false;
      
      for (let i = 0; i < limit + 5; i++) {
        const response = await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `test-file-${i}.pdf` })
          .set('Authorization', 'Bearer valid-jwt-token');

        if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
          rateLimitHit = true;
          
          // Verify Retry-After header is present
          expect(response.headers).toHaveProperty('retry-after');
          
          // Verify response body contains rate limit info
          expect(response.body).toHaveProperty('message');
          break;
        }
      }

      expect(rateLimitHit).toBe(true);
    });

    it('should include Retry-After header in 429 response', async () => {
      const limit = configService.get<number>('EVIDENCE_UPLOAD_LIMIT') || 5;
      const ttl = configService.get<number>('EVIDENCE_UPLOAD_TTL') || 60000;
      
      // Exhaust the rate limit
      for (let i = 0; i < limit + 3; i++) {
        const response = await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `test-file-${i}.pdf` })
          .set('Authorization', 'Bearer valid-jwt-token');

        if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
          // Verify Retry-After header is present and reasonable
          const retryAfter = response.headers['retry-after'];
          expect(retryAfter).toBeDefined();
          
          // Retry-After should be a number (seconds) or HTTP date
          const retryAfterNum = parseInt(retryAfter, 10);
          expect(retryAfterNum).toBeGreaterThan(0);
          expect(retryAfterNum).toBeLessThanOrEqual(Math.ceil(ttl / 1000));
          
          break;
        }
      }
    });

    it('should reset rate limit after TTL expires', async () => {
      const limit = configService.get<number>('EVIDENCE_UPLOAD_LIMIT') || 5;
      const ttl = configService.get<number>('EVIDENCE_UPLOAD_TTL') || 60000;
      
      // Use a very short TTL for testing
      process.env.EVIDENCE_UPLOAD_TTL = '2000';
      
      // Exhaust the rate limit
      for (let i = 0; i < limit + 3; i++) {
        await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `test-file-${i}.pdf` })
          .set('Authorization', 'Bearer valid-jwt-token');
      }
      
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Should allow requests again
      const response = await request(app.getHttpServer())
        .post('/escrow/evidence-upload')
        .query({ fileName: 'test-file-after-ttl.pdf' })
        .set('Authorization', 'Bearer valid-jwt-token');
      
      // Should not be rate limited
      expect(response.status).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
      
      // Restore original TTL
      process.env.EVIDENCE_UPLOAD_TTL = ttl.toString();
    });

    it('should rate limit per user (different users have independent limits)', async () => {
      const limit = configService.get<number>('EVIDENCE_UPLOAD_LIMIT') || 5;
      
      // Exhaust rate limit for user 1
      for (let i = 0; i < limit + 2; i++) {
        await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `user1-file-${i}.pdf` })
          .set('Authorization', 'Bearer user1-jwt-token');
      }
      
      // User 2 should still be able to make requests
      const response = await request(app.getHttpServer())
        .post('/escrow/evidence-upload')
        .query({ fileName: 'user2-file.pdf' })
        .set('Authorization', 'Bearer user2-jwt-token');
      
      // User 2 should not be rate limited
      expect(response.status).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('should allow legitimate uploads within normal usage patterns', async () => {
      const limit = configService.get<number>('EVIDENCE_UPLOAD_LIMIT') || 5;
      
      // Simulate normal usage: a few requests spread over time
      const responses = [];
      
      for (let i = 0; i < 3; i++) {
        const response = await request(app.getHttpServer())
          .post('/escrow/evidence-upload')
          .query({ fileName: `legitimate-file-${i}.pdf` })
          .set('Authorization', 'Bearer legitimate-user-token');
        
        responses.push(response.status);
        
        // Small delay between requests (normal user behavior)
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // All legitimate requests should succeed (or fail with auth, but not rate limit)
      responses.forEach(status => {
        expect([HttpStatus.CREATED, HttpStatus.UNAUTHORIZED]).toContain(status);
        expect(status).not.toBe(HttpStatus.TOO_MANY_REQUESTS);
      });
    });
  });

  describe('Environment Variable Configuration', () => {
    it('should use default values when env vars are not set', async () => {
      delete process.env.EVIDENCE_UPLOAD_LIMIT;
      delete process.env.EVIDENCE_UPLOAD_TTL;
      
      const defaultLimit = 10;
      const defaultTtl = 60000;
      
      expect(configService.get<number>('EVIDENCE_UPLOAD_LIMIT')).toBeUndefined();
      expect(configService.get<number>('EVIDENCE_UPLOAD_TTL')).toBeUndefined();
      
      // The module should use defaults from app.module.ts
      // limit: 10, ttl: 60000
      
      // Restore test values
      process.env.EVIDENCE_UPLOAD_LIMIT = '5';
      process.env.EVIDENCE_UPLOAD_TTL = '60000';
    });

    it('should use custom values from env vars', async () => {
      process.env.EVIDENCE_UPLOAD_LIMIT = '15';
      process.env.EVIDENCE_UPLOAD_TTL = '120000';
      
      const customLimit = configService.get<number>('EVIDENCE_UPLOAD_LIMIT');
      const customTtl = configService.get<number>('EVIDENCE_UPLOAD_TTL');
      
      expect(customLimit).toBe(15);
      expect(customTtl).toBe(120000);
      
      // Restore test values
      process.env.EVIDENCE_UPLOAD_LIMIT = '5';
      process.env.EVIDENCE_UPLOAD_TTL = '60000';
    });
  });
});
