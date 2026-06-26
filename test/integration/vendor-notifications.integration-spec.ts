/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * Integration tests for vendor notification preference endpoints (issue #293).
 *
 * Covered endpoints:
 *   GET   /vendor/profile/notifications
 *   PATCH /vendor/profile/notifications
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DEFAULT_NOTIFICATION_PREFERENCES, PrismaService } from '../../src/prisma/prisma.service';

describe('Vendor notification preferences (issue #293)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR = 'GVENDORNOT001';
  const AUTH = `Bearer ${VENDOR}`;

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
    await prisma.reset();

    // Pre-create a vendor profile for tests that need one
    await request(app.getHttpServer())
      .post('/vendor/profile')
      .set('Authorization', AUTH)
      .send({
        businessName: 'Notif Co',
        contactEmail: 'notif@example.com',
      });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /vendor/profile/notifications ────────────────────────────────────

  describe('GET /vendor/profile/notifications', () => {
    it('returns the default notification preferences on first fetch', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .expect(200);

      expect(res.body).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it('returns 404 when the vendor has no profile', async () => {
      await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .set('Authorization', 'Bearer GNOPROFILE')
        .expect(404);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .expect(401);
    });
  });

  // ── PATCH /vendor/profile/notifications ──────────────────────────────────

  describe('PATCH /vendor/profile/notifications', () => {
    it('updates a single preference without overwriting the others', async () => {
      const res = await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ sms: true })
        .expect(200);

      // sms toggled on; email and inApp remain at defaults
      expect(res.body.sms).toBe(true);
      expect(res.body.email).toBe(DEFAULT_NOTIFICATION_PREFERENCES.email);
      expect(res.body.inApp).toBe(DEFAULT_NOTIFICATION_PREFERENCES.inApp);
    });

    it('updates multiple preferences in one call', async () => {
      const res = await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ email: false, sms: true })
        .expect(200);

      expect(res.body.email).toBe(false);
      expect(res.body.sms).toBe(true);
    });

    it('persists preferences across requests', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ sms: true })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .expect(200);

      expect(res.body.sms).toBe(true);
    });

    it('does not overwrite un-sent fields on partial update', async () => {
      // First set all three
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ email: false, sms: true, inApp: false })
        .expect(200);

      // Second patch: only change email
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ email: true })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .expect(200);

      expect(res.body.email).toBe(true);
      expect(res.body.sms).toBe(true);   // unchanged from second patch
      expect(res.body.inApp).toBe(false); // unchanged from second patch
    });

    it('returns 400 for invalid preference values (non-boolean)', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ email: 'yes' })
        .expect(400);
    });

    it('returns 404 when the vendor has no profile', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', 'Bearer GNOPROFILE2')
        .send({ sms: true })
        .expect(404);
    });
  });
});
