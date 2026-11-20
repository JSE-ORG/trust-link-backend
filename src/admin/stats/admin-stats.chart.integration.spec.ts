import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { bearer } from '../../../test/auth-helper';
import { ensureVendors } from '../../../test/prisma-helpers';

const VENDOR_ADDRESS = 'GADMINVENDOR001';
const BUYER_ADDRESS = 'GADMINBUYER001';
const NON_ADMIN_ADDRESS = 'GADMINNONADMIN001';

describe('GET /admin/stats/chart integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAddress: string;

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
    adminAddress = app.get(ConfigService).get('ADMIN_ADDRESS');
  });

  beforeEach(async () => {
    await prisma.reset();
    await ensureVendors(prisma, VENDOR_ADDRESS);
  });

  afterAll(async () => {
    await prisma.reset();
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects unauthorized calls', async () => {
    await request(app.getHttpServer()).get('/admin/stats/chart').expect(401);
  });

  it('rejects non-admin callers with 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/stats/chart')
      .set('Authorization', bearer(NON_ADMIN_ADDRESS))
      .expect(403);
  });

  it('rejects invalid days parameter with 400', async () => {
    await request(app.getHttpServer())
      .get('/admin/stats/chart?days=500')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(400);

    await request(app.getHttpServer())
      .get('/admin/stats/chart?days=0')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(400);
  });

  it('returns 30 daily buckets by default with zero-filled gaps', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/stats/chart')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(30);
    expect(res.body[0]).toHaveProperty('date');
    expect(res.body[0]).toHaveProperty('escrowsCreated');
    expect(res.body[0]).toHaveProperty('volume');
    expect(res.body[0]).toHaveProperty('completed');
    expect(res.body[0]).toHaveProperty('disputed');
  });

  it('aggregates daily escrows, volume, completed, and disputed counts', async () => {
    const now = new Date();
    await prisma.escrow.create({
      data: {
        itemName: 'Test completed escrow',
        itemRef: 'chart-ref-1',
        amount: 500,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
        vendorAddress: VENDOR_ADDRESS,
        state: 'COMPLETED',
        createdAt: now,
      },
    });

    await prisma.escrow.create({
      data: {
        itemName: 'Test disputed escrow',
        itemRef: 'chart-ref-2',
        amount: 250,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
        vendorAddress: VENDOR_ADDRESS,
        state: 'DISPUTED',
        createdAt: now,
      },
    });

    const res = await request(app.getHttpServer())
      .get('/admin/stats/chart?days=7')
      .set('Authorization', bearer(adminAddress, { role: 'admin' }))
      .expect(200);

    expect(res.body).toHaveLength(7);
    const todayKey = now.toISOString().slice(0, 10);
    const todayEntry = res.body.find(
      (item: { date: string }) => item.date === todayKey,
    );

    expect(todayEntry).toBeDefined();
    expect(todayEntry.escrowsCreated).toBe(2);
    expect(todayEntry.volume).toBe(750);
    expect(todayEntry.completed).toBe(1);
    expect(todayEntry.disputed).toBe(1);
  });
});
