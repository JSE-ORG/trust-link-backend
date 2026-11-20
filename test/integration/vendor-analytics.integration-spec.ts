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
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

describe('GET /vendor/analytics/chart (issue #290)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const VENDOR = 'GANALYTICS001';
  const OTHER_VENDOR = 'GANALYTICS002';
  const AUTH = bearer(VENDOR);

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
    await ensureVendors(prisma, 'GANALYTICS001', 'GANALYTICS002');
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

  function dateKeyInTimezone(date: Date, timezone: string): string {
    const parts = new Map(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(date)
        .map(({ type, value }) => [type, value]),
    );
    return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
  }

  function addCalendarDays(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  function localMidnight(dateKey: string, timezone: string): Date {
    const [year, month, day] = dateKey.split('-').map(Number);
    const target = Date.UTC(year, month - 1, day);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    let candidate = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = new Map(
        formatter
          .formatToParts(new Date(candidate))
          .map(({ type, value }) => [type, Number(value)]),
      );
      const part = (
        name: keyof Intl.DateTimeFormatPartTypesRegistry,
      ): number => {
        const value = parts.get(name);
        if (value === undefined) {
          throw new Error(`Missing ${name} date part for timezone ${timezone}`);
        }
        return value;
      };
      const representedAsUtc = Date.UTC(
        part('year'),
        part('month') - 1,
        part('day'),
        part('hour'),
        part('minute'),
        part('second'),
      );
      const correction = target - representedAsUtc;
      candidate += correction;
      if (correction === 0) break;
    }
    return new Date(candidate);
  }

  // Escrow declares @@unique([vendorAddress, itemRef]), so every seeded escrow
  // needs its own itemRef; a fixed one only worked against the constraint-free
  // in-memory store (#475).
  let seedCounter = 0;

  /**
   * Seeds an escrow directly in PrismaService with a controlled createdAt date.
   */
  async function seedEscrow(
    vendorAddress: string,
    amount: number,
    createdAt: Date,
  ): Promise<void> {
    await prisma.escrow.create({
      data: {
        itemName: 'Test item',
        itemRef: `ref-analytics-${++seedCounter}`,
        amount,
        currency: 'USDC',
        buyerAddress: 'GBUYER001',
        vendorAddress,
        createdAt,
      },
    });
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

  it.each(['America/New_York', 'Asia/Tokyo'])(
    'starts the %s chart at its local midnight boundary',
    async (timezone) => {
      const todayKey = dateKeyInTimezone(new Date(), timezone);
      const firstDayKey = addCalendarDays(todayKey, -1);
      const firstDayStart = localMidnight(firstDayKey, timezone);

      // The event just before local midnight must be excluded; one just after
      // midnight belongs to the first complete calendar day in the window.
      await seedEscrow(VENDOR, 999, new Date(firstDayStart.getTime() - 1_000));
      await seedEscrow(VENDOR, 25, new Date(firstDayStart.getTime() + 1_000));

      const res = await request(app.getHttpServer())
        .get('/vendor/analytics/chart')
        .query({ days: 2, timezone })
        .set('Authorization', AUTH)
        .expect(200);

      expect(res.body.period.startDate).toBe(firstDayKey);
      expect(res.body.period.endDate).toBe(todayKey);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          date: firstDayKey,
          totalVolume: 25,
          transactionCount: 1,
        }),
      );
      expect(res.body.summary.totalVolume).toBe(25);
      expect(res.body.summary.totalTransactions).toBe(1);
    },
  );

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
  // ── Interval grouping (issue #1155) ──────────────────────────────────────

  it('aggregates by weekly interval across a month boundary', async () => {
    const d1 = new Date('2026-05-28T12:00:00.000Z');
    const d2 = new Date('2026-06-02T12:00:00.000Z');
    await seedEscrow(VENDOR, 100, d1);
    await seedEscrow(VENDOR, 200, d2);

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .query({ interval: 'week', days: 60 })
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(1);
    const sumVolume = res.body.data.reduce(
      (sum: number, b: { totalVolume: number }) => sum + b.totalVolume,
      0,
    );
    expect(sumVolume).toBe(300);
  });

  it('aggregates by monthly interval across month boundaries', async () => {
    const d1 = new Date('2026-04-15T10:00:00.000Z');
    const d2 = new Date('2026-05-20T10:00:00.000Z');
    await seedEscrow(VENDOR, 150, d1);
    await seedEscrow(VENDOR, 250, d2);

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .query({ interval: 'month', days: 90 })
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(1);
    const sumVolume = res.body.data.reduce(
      (sum: number, b: { totalVolume: number }) => sum + b.totalVolume,
      0,
    );
    expect(sumVolume).toBe(400);
  });
});
