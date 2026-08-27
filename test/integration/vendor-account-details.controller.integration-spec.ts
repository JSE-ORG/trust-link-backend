/**
 * Integration tests for vendor-account-details controller (issue #642).
 *
 * Drives GET /vendor/account-details and PATCH /vendor/account-details over
 * HTTP through the Nest testing module.  Verifies authentication, vendor data
 * isolation, sensitive-field masking, and validation failure (400) handling.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

describe('Vendor account-details controller (issue #642)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR_A = 'GVENDORACCTCTRL001';
  const VENDOR_B = 'GVENDORACCTCTRL002';
  const AUTH_A = bearer(VENDOR_A);
  const AUTH_B = bearer(VENDOR_B);

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.reset();
    await ensureVendors(prisma, VENDOR_A, VENDOR_B);
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /vendor/account-details ────────────────────────────────────────

  describe('GET /vendor/account-details', () => {
    it('returns null when no details exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .expect(200);

      // Nest serializes a controller `null` return as an empty body
      expect(res.text).toBe('');
    });

    it('returns account details with masked sensitive fields', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .send({ bankAccountNumber: '1234567890123456', taxId: 'TAX-123456789' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .expect(200);

      expect(res.body.vendorAddress).toBe(VENDOR_A);
      expect(res.body.bankAccountNumber).toBe('************3456');
      expect(res.body.taxId).toBe('*********6789');
    });

    it('isolates vendor data across accounts', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .send({ bankAccountNumber: '1111222233334444' })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/vendor/account-details')
        .set('Authorization', AUTH_B)
        .send({ bankAccountNumber: '9999888877776666' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .expect(200);

      expect(res.body.bankAccountNumber).toBe('************4444');
      expect(res.body.bankAccountNumber).not.toContain('6666');
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/vendor/account-details')
        .expect(401);
    });
  });

  // ── PATCH /vendor/account-details ──────────────────────────────────────

  describe('PATCH /vendor/account-details', () => {
    it('creates account details on first update', async () => {
      const res = await request(app.getHttpServer())
        .patch('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .send({ bankAccountNumber: '1234567890123456', preferredCurrency: 'EUR' })
        .expect(200);

      expect(res.body.vendorAddress).toBe(VENDOR_A);
      expect(res.body.preferredCurrency).toBe('EUR');
      expect(res.body.bankAccountNumber).toBe('************3456');
    });

    it('updates existing account details', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .send({ preferredCurrency: 'EUR' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .send({ preferredCurrency: 'GBP' })
        .expect(200);

      expect(res.body.preferredCurrency).toBe('GBP');
    });

    it('masks sensitive fields in the response', async () => {
      const res = await request(app.getHttpServer())
        .patch('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .send({ bankAccountNumber: '1234567890123456', taxId: 'TAX-123456789' })
        .expect(200);

      expect(res.body.bankAccountNumber).toBe('************3456');
      expect(res.body.taxId).toBe('*********6789');
      expect(res.body.bankAccountNumber).not.toBe('1234567890123456');
      expect(res.body.taxId).not.toBe('TAX-123456789');
    });

    it('returns 400 for non-whitelisted fields', async () => {
      const res = await request(app.getHttpServer())
        .patch('/vendor/account-details')
        .set('Authorization', AUTH_A)
        .send({ bankAccountNumber: '1234567890123456', kycStatus: 'APPROVED' })
        .expect(400);

      expect(res.body.message).toContain('property kycStatus should not exist');
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .patch('/vendor/account-details')
        .send({ bankAccountNumber: '1234567890123456' })
        .expect(401);
    });
  });
});
