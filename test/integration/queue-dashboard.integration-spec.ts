/**
 * Integration tests for GET /admin/queues (issue #638).
 *
 * Exercises QueueDashboardController over HTTP through the Nest testing
 * module, mirroring admin-stats.integration-spec.ts's shape. No REDIS_URL is
 * configured for the integration test env (.env.test), so
 * QueueDashboardService.onModuleInit logs a warning and falls back to empty
 * queue data (see queue-dashboard.service.ts) rather than connecting to a
 * real Redis — exactly the behaviour this suite exercises, without needing a
 * live BullMQ/Redis instance in CI.
 *
 * Note on the "validation returns 400" acceptance criterion: GET /admin/queues
 * takes no request body or query parameters, so there is no invalid-input
 * shape to assert a 400 against — every route on this controller (there is
 * only the one) is instead covered by the auth/authorisation and success-path
 * tests below.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';

describe('Queue Dashboard (issue #638)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configService: ConfigService;
  let adminAddress: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    configService = app.get(ConfigService);
    adminAddress = configService.get('ADMIN_ADDRESS');
    await prisma.reset();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /admin/queues', () => {
    it('returns queue dashboard data for an admin caller', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/queues')
        .set('Authorization', bearer(adminAddress, { role: 'admin' }))
        .expect(200);

      expect(res.body).toHaveProperty('queues');
      expect(Array.isArray(res.body.queues)).toBe(true);
      expect(res.body).toHaveProperty('generatedAt');
      expect(typeof res.body.generatedAt).toBe('string');
      expect(() => new Date(res.body.generatedAt)).not.toThrow();

      // Each queue entry, if any is returned, has the documented shape.
      for (const queue of res.body.queues) {
        expect(typeof queue.name).toBe('string');
        expect(typeof queue.isPaused).toBe('boolean');
        expect(queue.counts).toEqual(
          expect.objectContaining({
            waiting: expect.any(Number),
            active: expect.any(Number),
            completed: expect.any(Number),
            failed: expect.any(Number),
            delayed: expect.any(Number),
            paused: expect.any(Number),
          }),
        );
      }
    });

    it('does not throw a 500 when Redis is unavailable (falls back to zeroed queue stats)', async () => {
      // .env.test sets no REDIS_URL, so this exercises the service's real
      // fallback path rather than a mock standing in for a live queue.
      const res = await request(app.getHttpServer())
        .get('/admin/queues')
        .set('Authorization', bearer(adminAddress, { role: 'admin' }))
        .expect(200);

      expect(res.body.queues).toEqual([
        {
          name: 'auto-release',
          counts: {
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            paused: 0,
          },
          isPaused: false,
        },
        {
          name: 'tracking-poll',
          counts: {
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            paused: 0,
          },
          isPaused: false,
        },
        {
          name: 'notifications-retry',
          counts: {
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            paused: 0,
          },
          isPaused: false,
        },
      ]);
    });
  });

  describe('Authorization', () => {
    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer()).get('/admin/queues').expect(401);
    });

    it('returns 401 for a malformed bearer token', async () => {
      await request(app.getHttpServer())
        .get('/admin/queues')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('returns 403 for an authenticated non-admin caller', async () => {
      await request(app.getHttpServer())
        .get('/admin/queues')
        .set('Authorization', bearer('GVENDORNOTADMIN001'))
        .expect(403);
    });
  });
});
