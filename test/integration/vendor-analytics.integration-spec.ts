/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * Integration tests for GET /vendor/analytics/chart (issue #290).
 *
 * Verifies daily volume time-series: date grouping, data accuracy,
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

  /** Helper: create an escrow directly in PrismaService with a specific date. */
  function seedEscrow(
    vendorAddress: string,
    amount: number,
    createdAt: Date,
  ) {
    return prisma.escrow.create({
      data: {
        itemName: 'Test item',
        amount,
        currency: 'USDC',
        buyerAddress: 'GBUYER001',
        vendorAddress,
        state: 'FUNDED',
        // Override createdAt by patching after creation
      },
    }).then((e) => {
      // Directly mutate the stored record's createdAt so we can control grouping
      (prisma as any).escrows.set(e.id, { ...e, createdAt });
      return e;
    });
  }

  // ── Empty chart ──────────────────────────────────────────────────────────

  it('returns an empty array when the vendor has no escrows', async () => {
    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  // ── Daily volume retrieval ────────────────────────────────────────────────

  it('returns daily volume for a single-day set of escrows', async () => {
    const day = new Date('2024-03-15T10:00:00Z');
    await seedEscrow(VENDOR, 100, day);
    await seedEscrow(VENDOR, 50, day);

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual({ date: '2024-03-15', volume: 150 });
  });

  // ── Correct date grouping ─────────────────────────────────────────────────

  it('groups escrows by UTC calendar day and returns sorted results', async () => {
    await seedEscrow(VENDOR, 200, new Date('2024-03-14T08:00:00Z'));
    await seedEscrow(VENDOR, 75, new Date('2024-03-14T22:30:00Z'));
    await seedEscrow(VENDOR, 300, new Date('2024-03-15T00:01:00Z'));

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toEqual({ date: '2024-03-14', volume: 275 });
    expect(res.body[1]).toEqual({ date: '2024-03-15', volume: 300 });
  });

  // ── Multiple days ─────────────────────────────────────────────────────────

  it('handles multiple non-contiguous days correctly', async () => {
    await seedEscrow(VENDOR, 100, new Date('2024-01-01T12:00:00Z'));
    await seedEscrow(VENDOR, 200, new Date('2024-01-05T12:00:00Z'));
    await seedEscrow(VENDOR, 50, new Date('2024-01-10T12:00:00Z'));

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body).toHaveLength(3);
    expect(res.body.map((d: { date: string }) => d.date)).toEqual([
      '2024-01-01',
      '2024-01-05',
      '2024-01-10',
    ]);
    expect(res.body[0].volume).toBe(100);
    expect(res.body[1].volume).toBe(200);
    expect(res.body[2].volume).toBe(50);
  });

  // ── Vendor data isolation ─────────────────────────────────────────────────

  it('only returns data for the authenticated vendor, not other vendors', async () => {
    const day = new Date('2024-06-01T12:00:00Z');
    await seedEscrow(VENDOR, 500, day);
    await seedEscrow(OTHER_VENDOR, 9999, day); // another vendor's escrow

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].volume).toBe(500); // only the authenticated vendor's amount
  });

  it('returns empty array for a vendor with no escrows even when other vendors have data', async () => {
    await seedEscrow(OTHER_VENDOR, 100, new Date('2024-06-01T12:00:00Z'));

    const res = await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  // ── Auth guard ────────────────────────────────────────────────────────────

  it('returns 401 for unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .get('/vendor/analytics/chart')
      .expect(401);
  });
});
