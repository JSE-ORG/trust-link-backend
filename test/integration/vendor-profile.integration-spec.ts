/**
 * Integration tests for vendor profile CRUD endpoints (issue #292, issue #643).
 *
 * Covered endpoints:
 *   POST  /vendor/profile
 *   GET   /vendor/profile
 *   PUT   /vendor/profile  (upsert — idempotent)
 *   PATCH /vendor/profile
 *   GET   /vendor/profile/notifications
 *   PATCH /vendor/profile/notifications
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ConfigModule } from '../../src/config/config.module';
import { JwtGuard } from '../../src/auth/guards/jwt.guard';
import { VendorProfileController } from '../../src/vendor/vendor-profile.controller';
import { VendorProfileService } from '../../src/vendor/vendor-profile.service';
import { VendorProfileRepository } from '../../src/vendor/vendor-profile.repository';
import { bearer } from '../auth-helper';

describe('Vendor profile CRUD (issue #292, issue #643)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR = 'GVENDORADDRESS001';
  const OTHER_VENDOR = 'GVENDORADDRESS002';
  const AUTH = bearer(VENDOR);

  const validProfile = {
    businessName: 'Acme Goods',
    email: 'contact@acme.example',
    phone: '+1-555-0100',
    description: 'Quality vintage goods',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule],
      controllers: [VendorProfileController],
      providers: [
        VendorProfileService,
        VendorProfileRepository,
        PrismaService,
        JwtGuard,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.vendorTrackingSettings.deleteMany();
    await prisma.vendorProfile.deleteMany();
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── POST /vendor/profile ─────────────────────────────────────────────────

  describe('POST /vendor/profile', () => {
    it('creates a profile and returns 201 with the record', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send(validProfile)
        .expect(201);

      expect(res.body).toEqual(
        expect.objectContaining({
          address: VENDOR,
          businessName: 'Acme Goods',
          email: 'contact@acme.example',
          phone: '+1-555-0100',
        }),
      );
    });

    it('returns 400 when businessName is missing', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send({ email: 'no-name@example.com' })
        .expect(400);
    });

    it('returns 400 for an invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send({ businessName: 'Bad Email Co', email: 'not-an-email' })
        .expect(400);
    });

    it('returns 409 when the same vendor address creates a second profile', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send(validProfile)
        .expect(201);

      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send({ businessName: 'Dupe', email: 'dupe@example.com' })
        .expect(409);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .send(validProfile)
        .expect(401);
    });
  });

  // ── GET /vendor/profile ──────────────────────────────────────────────────

  describe('GET /vendor/profile', () => {
    it('returns the vendor profile after creation', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send(validProfile)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/vendor/profile')
        .set('Authorization', AUTH)
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          address: VENDOR,
          businessName: 'Acme Goods',
          email: 'contact@acme.example',
        }),
      );
    });

    it('returns 404 for a non-existent profile', async () => {
      await request(app.getHttpServer())
        .get('/vendor/profile')
        .set('Authorization', AUTH)
        .expect(404);
    });

    it('isolates profiles — vendor A cannot see vendor B profile via GET', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', bearer(OTHER_VENDOR))
        .send({ businessName: 'Other Co', email: 'other@example.com' })
        .expect(201);

      // Vendor A has no profile — should get 404
      await request(app.getHttpServer())
        .get('/vendor/profile')
        .set('Authorization', AUTH)
        .expect(404);
    });
  });

  // ── PUT /vendor/profile (upsert) ─────────────────────────────────────────

  describe('PUT /vendor/profile', () => {
    it('creates the profile when it does not exist (upsert)', async () => {
      const res = await request(app.getHttpServer())
        .put('/vendor/profile')
        .set('Authorization', AUTH)
        .send({ businessName: 'New Co', email: 'new@example.com' })
        .expect(200);

      expect(res.body.businessName).toBe('New Co');
      expect(res.body.address).toBe(VENDOR);
    });

    it('replaces an existing profile with the new values', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send(validProfile)
        .expect(201);

      const res = await request(app.getHttpServer())
        .put('/vendor/profile')
        .set('Authorization', AUTH)
        .send({
          businessName: 'Acme Wholesale',
          email: 'wholesale@acme.example',
        })
        .expect(200);

      expect(res.body.businessName).toBe('Acme Wholesale');
      expect(res.body.email).toBe('wholesale@acme.example');
    });
  });

  // ── PATCH /vendor/profile ────────────────────────────────────────────────

  describe('PATCH /vendor/profile', () => {
    it('partially updates only the supplied fields', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send(validProfile)
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch('/vendor/profile')
        .set('Authorization', AUTH)
        .send({ businessName: 'Acme Updated' })
        .expect(200);

      expect(res.body.businessName).toBe('Acme Updated');
      // Original email preserved
      expect(res.body.email).toBe('contact@acme.example');
    });

    it('returns 404 when no profile exists', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile')
        .set('Authorization', AUTH)
        .send({ businessName: 'Ghost' })
        .expect(404);
    });
  });

  // ── GET /vendor/profile/notifications ───────────────────────────────────

  describe('GET /vendor/profile/notifications', () => {
    it('returns default notification preferences for an authenticated vendor', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .expect(200);

      expect(res.body).toEqual({
        notifyOnDelivery: true,
        notifyOnDelay: true,
        notifyOnException: true,
        notificationChannels: ['EMAIL'],
        webhookUrl: null,
        enableTracking: true,
        delayThresholdHours: 24,
        deliveryConfirmation: true,
        trackingHistoryRetentionDays: 90,
      });
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/vendor/profile/notifications')
        .expect(401);
    });
  });

  // ── PATCH /vendor/profile/notifications ─────────────────────────────────

  describe('PATCH /vendor/profile/notifications', () => {
    it('updates notification preferences when vendor profile exists', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send(validProfile)
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({
          notifyOnDelivery: false,
          notifyOnDelay: true,
          webhookUrl: 'https://example.com/webhook',
        })
        .expect(200);

      expect(res.body).toHaveProperty('trackingSettings');
      expect(res.body.trackingSettings).toEqual(
        expect.objectContaining({
          vendorAddress: VENDOR,
          notifyOnDelivery: false,
          notifyOnDelay: true,
          webhookUrl: 'https://example.com/webhook',
        }),
      );
    });

    it('returns 404 when updating notification preferences for non-existent profile', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({ notifyOnDelivery: false })
        .expect(404);
    });

    it('returns 400 when empty update payload is provided', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send(validProfile)
        .expect(201);

      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .set('Authorization', AUTH)
        .send({})
        .expect(400);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile/notifications')
        .send({ notifyOnDelivery: false })
        .expect(401);
    });
  });
});
