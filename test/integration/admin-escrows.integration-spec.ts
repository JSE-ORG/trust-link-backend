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
const ESC_1 = '11111111-1111-4111-8111-111111111111';
const ESC_2 = '22222222-2222-4222-8222-222222222222';
const ESC_3 = '33333333-3333-4333-8333-333333333333';
const MISSING = '99999999-9999-4999-8999-999999999999';

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
        id: ESC_1,
        itemRef: 'R1',
        amount: 300,
        vendorAddress: VENDOR_1,
        state: 'DISPUTED',
        createdAt: new Date('2026-01-10T00:00:00Z'),
        buyerContactEmail: 'enc',
      },
    });
    await prisma.escrow.create({
      data: {
        ...base,
        id: ESC_2,
        itemRef: 'R2',
        amount: 50,
        vendorAddress: VENDOR_1,
        state: 'FUNDED',
        createdAt: new Date('2026-02-10T00:00:00Z'),
      },
    });
    await prisma.escrow.create({
      data: {
        ...base,
        id: ESC_3,
        itemRef: 'R3',
        vendorAddress: VENDOR_2,
        state: 'FUNDED',
        buyerAddress: 'GOTHERBUYER',
        createdAt: new Date('2026-03-10T00:00:00Z'),
      },
    });
    await prisma.dispute.create({
      data: { id: 'disp-1', escrowId: ESC_1, reason: 'ITEM_NOT_RECEIVED' },
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
    expect(res.body).toMatchObject({
      total: 3,
      page: 1,
      limit: 2,
      totalPages: 2,
      hasNextPage: true,
    });
    expect((res.body.data as Array<{ id: string }>).map((e) => e.id)).toEqual([
      ESC_3,
      ESC_2,
    ]);
  });

  it.each([
    [{ state: 'DISPUTED' }, [ESC_1]],
    [{ vendorAddress: VENDOR_2 }, [ESC_3]],
    [{ buyerAddress: BUYER }, [ESC_2, ESC_1]],
    [{ from: '2026-02-01', to: '2026-02-28' }, [ESC_2]],
  ])('filters by %j', async (query, ids) => {
    const res = await list(query);
    expect(res.body.total).toBe(ids.length);
    expect((res.body.data as Array<{ id: string }>).map((e) => e.id)).toEqual(
      ids,
    );
  });

  it.each([
    [{ q: 'r2' }, [ESC_2]],
    [{ order: 'asc' }, [ESC_1, ESC_2, ESC_3]],
    [{ sort: 'amount', order: 'asc' }, [ESC_2, ESC_3, ESC_1]],
    [{ sort: 'amount' }, [ESC_1, ESC_3, ESC_2]],
  ])('searches and sorts by %j', async (query, ids) => {
    const res = await list(query);
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
      .get(`/admin/escrows/${ESC_1}`)
      .set('Authorization', adminAuth)
      .expect(200);
    expect(res.body).toMatchObject({
      id: ESC_1,
      dispute: { id: 'disp-1', reason: 'ITEM_NOT_RECEIVED' },
    });

    const plain = await request(server)
      .get(`/admin/escrows/${ESC_2}`)
      .set('Authorization', adminAuth)
      .expect(200);
    expect(plain.body.dispute).toBeNull();
  });

  it('returns 404 for an unknown escrow', async () => {
    await request(server)
      .get(`/admin/escrows/${MISSING}`)
      .set('Authorization', adminAuth)
      .expect(404);
  });

  it('returns 400 for a malformed escrow id', async () => {
    await request(server)
      .get('/admin/escrows/not-a-uuid')
      .set('Authorization', adminAuth)
      .expect(400);
  });

  it('exports matching escrows as CSV with a vendorAddress column', async () => {
    const res = await request(server)
      .get('/admin/escrows/export')
      .query({ vendorAddress: VENDOR_1 })
      .set('Authorization', adminAuth)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('escrows.csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'id,itemName,itemRef,amount,currency,state,buyerAddress,vendorAddress,createdAt,shippedAt,deliveredAt',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(
      `${ESC_2},Item,R2,50,USDC,FUNDED,${BUYER},${VENDOR_1},`,
    );
  });

  it('returns 403 for a vendor on every route', async () => {
    await request(server)
      .get('/admin/escrows')
      .set('Authorization', bearer(VENDOR_1))
      .expect(403);
    await request(server)
      .get(`/admin/escrows/${ESC_1}`)
      .set('Authorization', bearer(VENDOR_1))
      .expect(403);
    await request(server)
      .get('/admin/escrows/export')
      .set('Authorization', bearer(VENDOR_1))
      .expect(403);
  });

  it('returns 401 without a token', async () => {
    await request(server).get('/admin/escrows').expect(401);
  });
});
