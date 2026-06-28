/**
 * Integration tests for vendor notification preference endpoints (issue #293).
 *
 * Covered endpoints:
 *   GET   /vendor/profile/notifications
 *   PATCH /vendor/profile/notifications
 *
 * The upstream implementation stores preferences in VendorTrackingSettings.
 * Fields: notifyOnDelivery, notifyOnDelay, notifyOnException, notificationChannels,
 *         webhookUrl, enableTracking, delayThresholdHours, deliveryConfirmation,
 *         trackingHistoryRetentionDays.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

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

    // Pre-create a vendor profile so notifications endpoints can find the vendor
    await request(app.getHttpServer())
      .post('/vendor/profile')
      .set('Authorization', AUTH)
      .send({ businessName: 'Notif Co', email: 'notif@example.com' });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /vendor/profile/notifications ────────────────────────────────────

  describe('GET /vendor/profile/notifications', () => {
    it('returns platform defaults when no preferences have been set', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .expect(200);

      // Platform defaults defined in VendorProfileRepository.findNotificationPreferences
      expect(res.body.notifyOnDelivery).toBe(true);
      expect(res.body.notifyOnDelay).toBe(true);
      expect(res.body.notifyOnException).toBe(true);
      expect(res.body.notificationChannels).toEqual(['EMAIL']);
      expect(res.body.enableTracking).toBe(true);
    });

    it('returns platform defaults even when the vendor has no profile (upstream behaviour)', async () => {
      // The upstream implementation returns defaults from VendorTrackingSettings
      // without checking if a vendor profile exists — returns 200 with defaults.
      const res = await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .set('Authorization', 'Bearer GNOPROFILE')
        .expect(200);

      expect(res.body.notifyOnDelivery).toBe(true);
      expect(res.body.enableTracking).toBe(true);
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
        .send({ notifyOnDelay: false })
        .expect(200);

      // Response includes trackingSettings object
      expect(res.body.trackingSettings).toBeDefined();
      expect(res.body.trackingSettings.notifyOnDelay).toBe(false);
      // Other defaults should be untouched
      expect(res.body.trackingSettings.notifyOnDelivery).toBe(true);
    });

    it('updates notificationChannels to include SMS', async () => {
      const res = await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ notificationChannels: ['EMAIL', 'SMS'] })
        .expect(200);

      expect(res.body.trackingSettings.notificationChannels).toEqual(
        expect.arrayContaining(['EMAIL', 'SMS']),
      );
    });

    it('persists preference updates so subsequent GET reflects them', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ notifyOnDelivery: false, notifyOnDelay: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .expect(200);

      expect(res.body.notifyOnDelivery).toBe(false);
      expect(res.body.notifyOnDelay).toBe(false);
    });

    it('does not overwrite fields not included in the patch', async () => {
      // First patch: turn off delivery and delay
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ notifyOnDelivery: false, notifyOnDelay: false })
        .expect(200);

      // Second patch: only turn exception off
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ notifyOnException: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .expect(200);

      expect(res.body.notifyOnDelivery).toBe(false); // from first patch, unchanged
      expect(res.body.notifyOnDelay).toBe(false); // from first patch, unchanged
      expect(res.body.notifyOnException).toBe(false); // from second patch
    });

    it('returns 400 for an invalid notificationChannels value', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ notificationChannels: ['PIGEON'] })
        .expect(400);
    });

    it('returns 400 when notificationChannels is empty', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ notificationChannels: [] })
        .expect(400);
    });

    it('returns 404 when the vendor has no profile', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', 'Bearer GNOPROFILE2')
        .send({ notifyOnDelay: false })
        .expect(404);
    });
  });
});
