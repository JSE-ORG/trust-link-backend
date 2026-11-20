import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

type TestServer = Parameters<typeof request>[0];

const VENDOR_1 = 'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3';
const VENDOR_2 = 'GCZHXL5F4MTPVHLKQ62S7GQLI6IMTMYXJQWA762E3ROJ5HKMMN576V5F';
const BUYER = 'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2';

describe('GET /admin/escrows and GET /admin/escrows/:id', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: TestServer;
  let adminAuth: string;

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
    server = app.getHttpServer() as TestServer;
    adminAuth = bearer(app.get(ConfigService).get<string>('ADMIN_ADDRESS'), {
      role: 'admin',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.reset();
    await ensureVendors(prisma, VENDOR_1, VENDOR_2);
    const base = {
      itemName: 'Item',
      amount: 100,
      currency: 'USDC',
      buyerAddress: BUYER,
    };
    await prisma.escrow.create({
      data: {
        ...base,
        id: 'esc-1',
        itemRef: 'R1',
        vendorAddress: VENDOR_1,
        state: 'DISPUTED',
        createdAt: new Date('2026-01-10T00:00:00Z'),
        buyerContactEmail: 'enc',
      },
    });
    await prisma.escrow.create({
      data: {
        ...base,
        id: 'esc-2',
        itemRef: 'R2',
        vendorAddress: VENDOR_1,
        state: 'FUNDED',
        createdAt: new Date('2026-02-10T00:00:00Z'),
      },
    });
    await prisma.escrow.create({
      data: {
        ...base,
        id: 'esc-3',
        itemRef: 'R3',
        vendorAddress: VENDOR_2,
        state: 'FUNDED',
        buyerAddress: 'GOTHERBUYER',
        createdAt: new Date('2026-03-10T00:00:00Z'),
      },
    });
    await prisma.dispute.create({
      data: { id: 'disp-1', escrowId: 'esc-1', reason: 'ITEM_NOT_RECEIVED' },
    });
  });

  const list = (query: Record<string, string | number>) =>
    request(server)
      .get('/admin/escrows')
      .query(query)
      .set('Authorization', adminAuth)
      .expect(200);

  it('lists every escrow, newest first, paged', async () => {
    const res = await list({ limit: 2 });
    expect(res.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect((res.body.data as Array<{ id: string }>).map((e) => e.id)).toEqual([
      'esc-3',
      'esc-2',
    ]);
  });

  it.each([
    [{ state: 'DISPUTED' }, ['esc-1']],
    [{ vendorAddress: VENDOR_2 }, ['esc-3']],
    [{ buyerAddress: BUYER }, ['esc-2', 'esc-1']],
    [{ from: '2026-02-01', to: '2026-02-28' }, ['esc-2']],
  ])('filters by %j', async (query, ids) => {
    const res = await list(query);
    expect(res.body.total).toBe(ids.length);
    expect((res.body.data as Array<{ id: string }>).map((e) => e.id)).toEqual(
      ids,
    );
  });

  it('does not expose encrypted contact fields', async () => {
    const res = await list({ state: 'DISPUTED' });
    expect(res.body.data[0]).not.toHaveProperty('buyerContactEmail');
    expect(res.body.data[0]).not.toHaveProperty('buyerContactPhone');
  });

  it('returns one escrow with its dispute', async () => {
    const res = await request(server)
      .get('/admin/escrows/esc-1')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(res.body).toMatchObject({
      id: 'esc-1',
      dispute: { id: 'disp-1', reason: 'ITEM_NOT_RECEIVED' },
    });

    const plain = await request(server)
      .get('/admin/escrows/esc-2')
      .set('Authorization', adminAuth)
      .expect(200);
    expect(plain.body.dispute).toBeNull();
  });

  it('returns 404 for an unknown escrow', async () => {
    await request(server)
      .get('/admin/escrows/missing')
      .set('Authorization', adminAuth)
      .expect(404);
  });

  it('returns 403 for a vendor on both routes', async () => {
    await request(server)
      .get('/admin/escrows')
      .set('Authorization', bearer(VENDOR_1))
      .expect(403);
    await request(server)
      .get('/admin/escrows/esc-1')
      .set('Authorization', bearer(VENDOR_1))
      .expect(403);
  });

  it('returns 401 without a token', async () => {
    await request(server).get('/admin/escrows').expect(401);
  });
});
