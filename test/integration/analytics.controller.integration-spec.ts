/**
 * Integration tests for analytics controller endpoints (issue #641).
 *
 * Drives GET /vendor/analytics and GET /vendor/analytics/chart over HTTP
 * through the Nest testing module.  Verifies authentication, vendor data
 * isolation, and response shapes for both routes.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

describe('Analytics controller endpoints (issue #641)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR_A = 'GANALYTICSCTRL001';
  const VENDOR_B = 'GANALYTICSCTRL002';
  const AUTH_A = bearer(VENDOR_A);
  const BUYER = 'GBUYERCTRL001';

  let seedCounter = 0;

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
    await ensureVendors(prisma, VENDOR_A, VENDOR_B, BUYER);
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedEscrow(
    vendorAddress: string,
    amount: number,
    overrides?: { state?: string; createdAt?: Date },
  ) {
    return prisma.escrow.create({
      data: {
        itemName: 'Test Item',
        itemRef: `ref-analytics-ctrl-${++seedCounter}`,
        amount,
        currency: 'USDC',
        buyerAddress: BUYER,
        vendorAddress,
        state: (overrides?.state as any) ?? 'FUNDED',
        ...(overrides?.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
  }

  // ── GET /vendor/analytics ──────────────────────────────────────────────

  describe('GET /vendor/analytics', () => {
    it('returns transaction stats for the authenticated vendor', async () => {
      await seedEscrow(VENDOR_A, 100);
      await seedEscrow(VENDOR_A, 200);

      const res = await request(app.getHttpServer())
        .get('/vendor/analytics')
        .set('Authorization', AUTH_A)
        .expect(200);

      expect(res.body.stats.totalTransactions).toBe(2);
      expect(res.body.stats.totalVolume).toBeCloseTo(300, 1);
      expect(res.body).toHaveProperty('channels');
      expect(res.body).toHaveProperty('lastUpdated');
    });

    it('returns zero stats for a vendor with no escrows', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendor/analytics')
        .set('Authorization', AUTH_A)
        .expect(200);

      expect(res.body.stats.totalTransactions).toBe(0);
      expect(res.body.stats.totalVolume).toBe(0);
    });

    it('only returns data for the authenticated vendor', async () => {
      await seedEscrow(VENDOR_A, 100);
      await seedEscrow(VENDOR_B, 999);

      const res = await request(app.getHttpServer())
        .get('/vendor/analytics')
        .set('Authorization', AUTH_A)
        .expect(200);

      expect(res.body.stats.totalTransactions).toBe(1);
      expect(res.body.stats.totalVolume).toBeCloseTo(100, 1);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer()).get('/vendor/analytics').expect(401);
    });
  });

  // ── GET /vendor/analytics/chart ────────────────────────────────────────

  describe('GET /vendor/analytics/chart', () => {
    it('returns chart data for the authenticated vendor', async () => {
      await seedEscrow(VENDOR_A, 100);
      await seedEscrow(VENDOR_A, 200);

      const res = await request(app.getHttpServer())
        .get('/vendor/analytics/chart')
        .set('Authorization', AUTH_A)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('period');
      expect(res.body).toHaveProperty('summary');
      expect(res.body.summary.totalVolume).toBeCloseTo(300, 1);
      expect(res.body.summary.totalTransactions).toBe(2);
    });

    it('returns empty data for a vendor with no escrows', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendor/analytics/chart')
        .set('Authorization', AUTH_A)
        .expect(200);

      expect(res.body.summary.totalVolume).toBe(0);
      expect(res.body.summary.totalTransactions).toBe(0);
    });

    it('only returns chart data for the authenticated vendor', async () => {
      await seedEscrow(VENDOR_A, 100);
      await seedEscrow(VENDOR_B, 999);

      const res = await request(app.getHttpServer())
        .get('/vendor/analytics/chart')
        .set('Authorization', AUTH_A)
        .expect(200);

      expect(res.body.summary.totalVolume).toBeCloseTo(100, 1);
      expect(res.body.summary.totalTransactions).toBe(1);
    });

    it('returns 401 for unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/vendor/analytics/chart')
        .expect(401);
    });
  });
});
