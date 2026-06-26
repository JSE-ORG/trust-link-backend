/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
import { EscrowState } from '@prisma/client';

describe('GET /vendor/analytics (issue #289)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR_A = 'GANALYTICSSTAT001';
  const VENDOR_B = 'GANALYTICSSTAT002';
  const AUTH_A = `Bearer ${VENDOR_A}`;
  const AUTH_B = `Bearer ${VENDOR_B}`;
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
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedEscrow(
    vendorAddress: string,
    amount: number,
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

  it('returns 401 for unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/vendor/analytics').expect(401);
  });
});
