/**
 * Integration tests for GET /vendor/analytics (issue #289).
 *
 * Verifies transaction statistics: counts, volume, completion/dispute rates,
 * vendor data isolation, and empty-data behaviour for new vendors.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EscrowState } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

describe('GET /vendor/analytics (issue #289)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR_A = 'GANALYTICSSTAT001';
  const VENDOR_B = 'GANALYTICSSTAT002';
  const AUTH_A = bearer(VENDOR_A);
  const AUTH_B = bearer(VENDOR_B);
  const BUYER = 'GBUYER001';

  jest.setTimeout(30000);

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
    // Escrow.vendorAddress (and the vendor settings/details tables) are
    // foreign keys onto VendorProfile.address, so the parent rows must exist
    // before any row referencing them can be written (#475).
    await ensureVendors(prisma, 'GANALYTICSSTAT001', 'GANALYTICSSTAT002');
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedEscrow(
    vendorAddress: string,
    amount: number | string,
    state: EscrowState = 'FUNDED',
  ): Promise<void> {
    await prisma.escrow.create({
      data: {
        itemName: 'Test item',
        itemRef: `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        amount,
        currency: 'USDC',
        buyerAddress: BUYER,
        vendorAddress,
        state,
      },
    });
  }

  // ── Empty analytics ──────────────────────────────────────────────────────

  it('returns zero stats for a new vendor with no escrows', async () => {
    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalTransactions).toBe(0);
    expect(res.body.stats.totalVolume).toBe(0);
    expect(res.body.stats.completedTransactions).toBe(0);
    expect(res.body.stats.disputedTransactions).toBe(0);
    expect(res.body.stats.completionRate).toBe(0);
    expect(res.body.stats.disputeRate).toBe(0);
    expect(res.body.stats.averageTransactionValue).toBe(0);
    expect(res.body).toHaveProperty('lastUpdated');
  });

  // ── Successful analytics retrieval ────────────────────────────────────────

  it('returns stats with correct transaction count', async () => {
    await seedEscrow(VENDOR_A, 100, 'FUNDED');
    await seedEscrow(VENDOR_A, 200, 'SHIPPED');
    await seedEscrow(VENDOR_A, 300, 'COMPLETED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalTransactions).toBe(3);
  });

  it('returns stats with correct total volume', async () => {
    await seedEscrow(VENDOR_A, 100, 'FUNDED');
    await seedEscrow(VENDOR_A, 250.5, 'SHIPPED');
    await seedEscrow(VENDOR_A, 50, 'COMPLETED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalVolume).toBeCloseTo(400.5, 2);
    expect(res.body.stats.averageTransactionValue).toBeCloseTo(400.5 / 3, 2);
  });

  it('computes active and completed transaction counts correctly', async () => {
    await seedEscrow(VENDOR_A, 100, 'CREATED');
    await seedEscrow(VENDOR_A, 200, 'FUNDED');
    await seedEscrow(VENDOR_A, 300, 'SHIPPED');
    await seedEscrow(VENDOR_A, 400, 'DELIVERED');
    await seedEscrow(VENDOR_A, 500, 'COMPLETED');
    await seedEscrow(VENDOR_A, 600, 'COMPLETED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalTransactions).toBe(6);
    expect(res.body.stats.activeTransactions).toBe(4);
    expect(res.body.stats.completedTransactions).toBe(2);
    expect(res.body.stats.completionRate).toBeCloseTo((2 / 6) * 100, 1);
  });

  it('computes dispute rate correctly', async () => {
    await seedEscrow(VENDOR_A, 100, 'COMPLETED');
    await seedEscrow(VENDOR_A, 200, 'DISPUTED');
    await seedEscrow(VENDOR_A, 300, 'SHIPPED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalTransactions).toBe(3);
    expect(res.body.stats.disputedTransactions).toBe(1);
    expect(res.body.stats.disputeRate).toBeCloseTo((1 / 3) * 100, 1);
  });

  // ── Vendor data isolation ─────────────────────────────────────────────────

  it('returns only vendor A data when vendor A queries', async () => {
    await seedEscrow(VENDOR_A, 100, 'FUNDED');
    await seedEscrow(VENDOR_A, 200, 'SHIPPED');
    await seedEscrow(VENDOR_B, 999, 'COMPLETED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalTransactions).toBe(2);
    expect(res.body.stats.totalVolume).toBeCloseTo(300, 1);
  });

  it('returns only vendor B data when vendor B queries', async () => {
    await seedEscrow(VENDOR_A, 100, 'FUNDED');
    await seedEscrow(VENDOR_B, 500, 'SHIPPED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_B)
      .expect(200);

    expect(res.body.stats.totalTransactions).toBe(1);
    expect(res.body.stats.totalVolume).toBeCloseTo(500, 1);
  });

  it('returns zero totals for a vendor with no escrows when others have data', async () => {
    await seedEscrow(VENDOR_B, 9999, 'COMPLETED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalTransactions).toBe(0);
    expect(res.body.stats.totalVolume).toBe(0);
  });

  // ── Auth guard ────────────────────────────────────────────────────────────

  // ── Decimal precision (#843) ─────────────────────────────────────────────

  it('sums 8-decimal amounts exactly instead of as floats', async () => {
    // 0.1 + 0.2 === 0.30000000000000004 in binary floating point. The column
    // is Decimal(18, 8), so the exact total is 0.3 and the response must say so.
    await seedEscrow(VENDOR_A, '0.1', 'FUNDED');
    await seedEscrow(VENDOR_A, '0.2', 'FUNDED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalVolume).toBe(0.3);
  });

  it('sums many small amounts without accumulating float error', async () => {
    // 0.1 added ten times is 0.9999999999999999 as a float, 1 exactly in
    // decimal.
    for (let i = 0; i < 10; i++) {
      await seedEscrow(VENDOR_A, '0.1', 'COMPLETED');
    }

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalTransactions).toBe(10);
    expect(res.body.stats.totalVolume).toBe(1);
  });

  it('keeps a total past 2^53 minor units exact', async () => {
    // As floats these sum to ...995; the exact total is ...994.
    await seedEscrow(VENDOR_A, '90071992.54740993', 'FUNDED');
    await seedEscrow(VENDOR_A, '0.00000001', 'COMPLETED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalVolume).toBe(90071992.54740994);
  });

  it('averages fractional volumes exactly', async () => {
    await seedEscrow(VENDOR_A, '0.1', 'FUNDED');
    await seedEscrow(VENDOR_A, '0.1', 'FUNDED');
    await seedEscrow(VENDOR_A, '0.1', 'COMPLETED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(res.body.stats.totalVolume).toBe(0.3);
    expect(res.body.stats.averageTransactionValue).toBe(0.1);
  });

  it('returns the same response shape after the groupBy change', async () => {
    await seedEscrow(VENDOR_A, 100, 'FUNDED');
    await seedEscrow(VENDOR_A, 200, 'COMPLETED');
    await seedEscrow(VENDOR_A, 50, 'DISPUTED');

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics')
      .set('Authorization', AUTH_A)
      .expect(200);

    expect(Object.keys(res.body).sort()).toEqual([
      'channels',
      'lastUpdated',
      'stats',
    ]);
    expect(Object.keys(res.body.stats).sort()).toEqual(
      [
        'activeTransactions',
        'activeVolume',
        'averageTransactionValue',
        'cancelledTransactions',
        'completedTransactions',
        'completionRate',
        'disputedTransactions',
        'disputeRate',
        'totalTransactions',
        'totalVolume',
      ].sort(),
    );
    expect(res.body.stats.totalTransactions).toBe(3);
    expect(res.body.stats.totalVolume).toBe(350);
    expect(res.body.stats.activeTransactions).toBe(1);
    expect(res.body.stats.activeVolume).toBe(100);
  });

  // ── Auth guard ───────────────────────────────────────────────────────────

  it('returns 401 for unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/vendor/analytics').expect(401);
  });
});
