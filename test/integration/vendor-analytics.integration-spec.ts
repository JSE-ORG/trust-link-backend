/**
 * Integration tests for GET /vendor/analytics/chart (issue #290).
 *
 * The endpoint uses $queryRaw for date grouping (mocked by PrismaService in
 * the test environment).  Verifies daily volume time-series, date grouping,
 * vendor isolation, and empty-data behaviour.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('GET /vendor/analytics/chart (issue #290)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR = 'GANALYTICS001';
  const OTHER_VENDOR = 'GANALYTICS002';
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
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * Returns a Date N UTC days before today with the given UTC hour offset.
   * Using setUTCHours / setUTCDate ensures timezone-independent grouping.
   */
  function daysAgo(n: number, utcHour = 0): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    d.setUTCHours(utcHour, 0, 0, 0);
    return d;
  }

  /**
   * Seeds an escrow directly in PrismaService with a controlled createdAt date.
   */
  async function seedEscrow(
    vendorAddress: string,
    amount: number,
    createdAt: Date,
  ): Promise<void> {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Test item',
        amount,
        currency: 'USDC',
        buyerAddress: 'GBUYER001',
        vendorAddress,
      },
    });
    (prisma as any).escrows.set(escrow.id, { ...escrow, createdAt });
  }

  // ── Empty chart ──────────────────────────────────────────────────────────

  it('returns an empty data array (or all-zero entries) when the vendor has no escrows', async () => {
    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    // Response shape: { data: [...], period: {...}, summary: {...} }
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('period');
    expect(res.body).toHaveProperty('summary');
    // Total volume must be zero when no escrows exist
    expect(res.body.summary.totalVolume).toBe(0);
    expect(res.body.summary.totalTransactions).toBe(0);
  });

  // ── Daily volume retrieval ────────────────────────────────────────────────

  it('returns daily volume for escrows on a single day', async () => {
    const day = daysAgo(5); // 5 days ago, inside the default 30-day window
    await seedEscrow(VENDOR, 100, day);
    await seedEscrow(VENDOR, 50, day);

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    const expectedDate = day.toLocaleDateString('en-CA', { timeZone: 'UTC' });
    const dayEntry = res.body.data.find(
      (d: { date: string }) => d.date === expectedDate,
    );
    expect(dayEntry).toBeDefined();
    expect(dayEntry.totalVolume).toBe(150);
    expect(dayEntry.transactionCount).toBe(2);
  });

  // ── Correct date grouping ─────────────────────────────────────────────────

  it('groups escrows by UTC calendar day', async () => {
    // Two escrows on day T-10, one on day T-9
    const day1 = daysAgo(10, 8); // 8am UTC, 10 days ago
    const day1b = daysAgo(10, 22); // 10pm UTC, same day
    const day2 = daysAgo(9, 0); // midnight UTC, 9 days ago (different day)
    await seedEscrow(VENDOR, 200, day1);
    await seedEscrow(VENDOR, 75, day1b);
    await seedEscrow(VENDOR, 300, day2);

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    const date1str = day1.toLocaleDateString('en-CA', { timeZone: 'UTC' });
    const date2str = day2.toLocaleDateString('en-CA', { timeZone: 'UTC' });

    const entry1 = res.body.data.find(
      (d: { date: string }) => d.date === date1str,
    );
    const entry2 = res.body.data.find(
      (d: { date: string }) => d.date === date2str,
    );

    expect(entry1).toBeDefined();
    expect(entry1.totalVolume).toBe(275);
    expect(entry2).toBeDefined();
    expect(entry2.totalVolume).toBe(300);
  });

  // ── Vendor data isolation ─────────────────────────────────────────────────

  it('only returns data for the authenticated vendor', async () => {
    const day = daysAgo(3);
    await seedEscrow(VENDOR, 500, day);
    await seedEscrow(OTHER_VENDOR, 9999, day);

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    const expectedDate = day.toLocaleDateString('en-CA', { timeZone: 'UTC' });
    const vendorEntry = res.body.data.find(
      (d: { date: string }) => d.date === expectedDate,
    );
    expect(vendorEntry).toBeDefined();
    expect(vendorEntry.totalVolume).toBe(500); // not 9999 or 10499
  });

  it('returns zero summary totals for a vendor with no escrows when others have data', async () => {
    await seedEscrow(OTHER_VENDOR, 100, daysAgo(2));

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body.summary.totalVolume).toBe(0);
    expect(res.body.summary.totalTransactions).toBe(0);
  });

  // ── Summary statistics ────────────────────────────────────────────────────

  it('includes accurate summary totals in the response', async () => {
    const day = daysAgo(2);
    await seedEscrow(VENDOR, 400, day);
    await seedEscrow(VENDOR, 600, day);

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body.summary.totalVolume).toBe(1000);
    expect(res.body.summary.totalTransactions).toBe(2);
  });

  // ── Auth guard ────────────────────────────────────────────────────────────

  it('returns 401 for unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .expect(401);
  });
});
