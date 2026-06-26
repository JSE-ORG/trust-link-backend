/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * Integration tests for vendor profile CRUD endpoints (issue #292).
 *
 * Covered endpoints:
 *   POST  /vendor/profile
 *   GET   /vendor/profile
 *   PUT   /vendor/profile
 *   PATCH /vendor/profile
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Vendor profile CRUD (issue #292)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR = 'GVENDORADDRESS001';
  const OTHER_VENDOR = 'GVENDORADDRESS002';
  const AUTH = `Bearer ${VENDOR}`;

  const validProfile = {
    businessName: 'Acme Goods',
    contactEmail: 'contact@acme.example',
    contactPhone: '+1-555-0100',
  };

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
  });

  afterEach(async () => {
    await app.close();
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
          id: expect.any(String),
          vendorAddress: VENDOR,
          businessName: 'Acme Goods',
          contactEmail: 'contact@acme.example',
          contactPhone: '+1-555-0100',
        }),
      );
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send({ businessName: 'No Email' })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('contactEmail')]),
      );
    });

    it('returns 400 for invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', AUTH)
        .send({ businessName: 'Bad Email Co', contactEmail: 'not-an-email' })
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
        .send({ businessName: 'Dupe', contactEmail: 'dupe@example.com' })
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
          vendorAddress: VENDOR,
          businessName: 'Acme Goods',
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
      // Create vendor B profile
      await request(app.getHttpServer())
        .post('/vendor/profile')
        .set('Authorization', `Bearer ${OTHER_VENDOR}`)
        .send({ businessName: 'Other Co', contactEmail: 'other@example.com' })
        .expect(201);

      // Vendor A has no profile
      await request(app.getHttpServer())
        .get('/vendor/profile')
        .set('Authorization', AUTH)
        .expect(404);
    });
  });

  // ── PUT /vendor/profile ──────────────────────────────────────────────────

  describe('PUT /vendor/profile', () => {
    it('replaces the profile and returns the updated record', async () => {
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
          contactEmail: 'wholesale@acme.example',
        })
        .expect(200);

      expect(res.body.businessName).toBe('Acme Wholesale');
      expect(res.body.contactEmail).toBe('wholesale@acme.example');
      // Phone cleared on full replacement when not provided
      expect(res.body.contactPhone).toBeNull();
    });

    it('returns 404 when no profile exists', async () => {
      await request(app.getHttpServer())
        .put('/vendor/profile')
        .set('Authorization', AUTH)
        .send(validProfile)
        .expect(404);
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
      expect(res.body.contactEmail).toBe('contact@acme.example');
    });

    it('returns 404 when no profile exists', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/profile')
        .set('Authorization', AUTH)
        .send({ businessName: 'Ghost' })
        .expect(404);
    });
  });
});
