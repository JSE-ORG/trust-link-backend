import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EscrowState } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

describe('Admin vendor analytics (#1216)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAuth: string;

  const VENDOR = 'GANALYTICSVIEW001';
  const NON_ADMIN = 'GNONADMINANALYTICS001';
  const BUYER = 'GBUYERANALYTICS001';
  let seedCounter = 0;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    const adminAddress = app.get(ConfigService).get<string>('ADMIN_ADDRESS');
    adminAuth = bearer(adminAddress, { role: 'admin' });
  });

  beforeEach(async () => {
    await prisma.reset();
    await ensureVendors(prisma, VENDOR, BUYER);
    seedCounter = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedEscrow(
    amount: number,
    state: EscrowState,
    createdAt: Date,
  ): Promise<void> {
    await prisma.escrow.create({
      data: {
        vendorAddress: VENDOR,
        itemName: `Analytics item ${seedCounter}`,
        itemRef: `ref-admin-analytics-${++seedCounter}`,
        amount,
        currency: 'USDC',
        buyerAddress: BUYER,
        state,
        createdAt,
      },
    });
  }

  it('returns the vendor stats response shape for an admin', async () => {
    await seedEscrow(120, 'COMPLETED', new Date('2026-01-10T10:00:00Z'));
    await seedEscrow(80, 'DISPUTED', new Date('2026-01-11T10:00:00Z'));

    const response = await request(app.getHttpServer())
      .get(`/admin/vendors/${VENDOR}/analytics`)
      .set('Authorization', adminAuth)
      .expect(200);

    expect(response.body.stats.totalTransactions).toBe(2);
    expect(response.body.stats.totalVolume).toBe(200);
    expect(response.body.stats.completedTransactions).toBe(1);
    expect(response.body.stats.disputedTransactions).toBe(1);
    expect(response.body).toHaveProperty('channels');
    expect(response.body).toHaveProperty('lastUpdated');
  });

  it('returns chart data using the vendor chart query options', async () => {
    await seedEscrow(120, 'COMPLETED', new Date('2026-01-10T10:00:00Z'));
    await seedEscrow(80, 'DISPUTED', new Date('2026-01-11T10:00:00Z'));

    const response = await request(app.getHttpServer())
      .get(`/admin/vendors/${VENDOR}/analytics/chart`)
      .query({
        from: '2026-01-10',
        to: '2026-01-12',
        timezone: 'UTC',
        interval: 'day',
      })
      .set('Authorization', adminAuth)
      .expect(200);

    expect(response.body.period).toEqual({
      startDate: '2026-01-10',
      endDate: '2026-01-12',
    });
    expect(response.body.data).toHaveLength(3);
    expect(response.body.summary.totalTransactions).toBe(2);
    expect(response.body.summary.totalVolume).toBe(200);
  });

  it('returns 404 for an unknown vendor on both analytics routes', async () => {
    const unknown = 'GUNKNOWNANALYTICSVENDOR001';

    await request(app.getHttpServer())
      .get(`/admin/vendors/${unknown}/analytics`)
      .set('Authorization', adminAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/admin/vendors/${unknown}/analytics/chart`)
      .set('Authorization', adminAuth)
      .expect(404);
  });

  it('rejects vendor access with 403', async () => {
    await request(app.getHttpServer())
      .get(`/admin/vendors/${VENDOR}/analytics`)
      .set('Authorization', bearer(NON_ADMIN))
      .expect(403);
  });
});
