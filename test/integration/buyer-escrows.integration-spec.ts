import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EscrowState } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

type TestServer = Parameters<typeof request>[0];

const VENDOR = 'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3';
const VENDOR_2 = 'GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A';
const BUYER_A = 'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2';
const BUYER_B = 'GCZHXL5F4MTPVHLKQ62S7GQLI6IMTMYXJQWA762E3ROJ5HKMMN576V5F';

describe('GET /buyer/escrows and GET /vendor/escrows/export', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: TestServer;

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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.reset();
    await ensureVendors(prisma, VENDOR, VENDOR_2);
    const rows: Array<[string, string, string, string, EscrowState]> = [
      ['A-1', 'Camera', BUYER_A, VENDOR, 'FUNDED'],
      ['A-2', 'Lens', BUYER_A, VENDOR, 'FUNDED'],
      ['A-3', 'Tripod', BUYER_A, VENDOR_2, 'SHIPPED'],
      ['B-1', '=HYPERLINK("http://x")', BUYER_B, VENDOR, 'FUNDED'],
    ];
    for (const [
      itemRef,
      itemName,
      buyerAddress,
      vendorAddress,
      state,
    ] of rows) {
      await prisma.escrow.create({
        data: {
          itemRef,
          itemName,
          buyerAddress,
          vendorAddress,
          amount: 100,
          currency: 'USDC',
          state,
        },
      });
    }
  });

  it('returns only the calling buyer’s escrows', async () => {
    const a = await request(server)
      .get('/buyer/escrows')
      .set('Authorization', bearer(BUYER_A))
      .expect(200);
    const b = await request(server)
      .get('/buyer/escrows')
      .set('Authorization', bearer(BUYER_B))
      .expect(200);

    expect(a.body.total).toBe(3);
    expect(
      (a.body.data as Array<{ itemRef: string }>).map((e) => e.itemRef).sort(),
    ).toEqual(['A-1', 'A-2', 'A-3']);
    expect(b.body.total).toBe(1);
    expect(b.body.data[0].itemRef).toBe('B-1');
  });

  it('filters the buyer’s escrows by vendorAddress (#1210)', async () => {
    const res = await request(server)
      .get('/buyer/escrows')
      .query({ vendorAddress: VENDOR_2 })
      .set('Authorization', bearer(BUYER_A))
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.data[0].itemRef).toBe('A-3');
  });

  it('accepts a comma-separated state filter and rejects an invalid one (#1211)', async () => {
    const multi = await request(server)
      .get('/buyer/escrows')
      .query({ state: 'FUNDED,SHIPPED' })
      .set('Authorization', bearer(BUYER_A))
      .expect(200);
    expect(multi.body.total).toBe(3);

    const single = await request(server)
      .get('/buyer/escrows')
      .query({ state: 'SHIPPED' })
      .set('Authorization', bearer(BUYER_A))
      .expect(200);
    expect(single.body.total).toBe(1);

    await request(server)
      .get('/buyer/escrows')
      .query({ state: 'FUNDED,NOT_A_STATE' })
      .set('Authorization', bearer(BUYER_A))
      .expect(400);
  });

  it('ignores a buyerAddress query naming another buyer', async () => {
    const res = await request(server)
      .get('/buyer/escrows')
      .query({ buyerAddress: BUYER_A })
      .set('Authorization', bearer(BUYER_B))
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.data[0].itemRef).toBe('B-1');
  });

  it('supports the vendor list options (q, paging)', async () => {
    const res = await request(server)
      .get('/buyer/escrows')
      .query({ q: 'lens', page: 1, limit: 1 })
      .set('Authorization', bearer(BUYER_A))
      .expect(200);

    expect(res.body).toMatchObject({ total: 1, page: 1, limit: 1 });
  });

  it('rejects an unauthenticated caller', async () => {
    await request(server).get('/buyer/escrows').expect(401);
  });

  it('exports the vendor’s escrows as escaped CSV with the same filters', async () => {
    const res = await request(server)
      .get('/vendor/escrows/export')
      .query({ buyerAddress: BUYER_B })
      .set('Authorization', bearer(VENDOR))
      .expect(200);

    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toContain('escrows.csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'id,itemName,itemRef,amount,currency,state,buyerAddress,createdAt,shippedAt,deliveredAt',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('exports the buyer’s escrows as CSV with vendorAddress in place of buyerAddress (#1209)', async () => {
    const res = await request(server)
      .get('/buyer/escrows/export')
      .set('Authorization', bearer(BUYER_A))
      .expect(200);

    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toContain('escrows.csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'id,itemName,itemRef,amount,currency,state,vendorAddress,createdAt,shippedAt,deliveredAt',
    );
    expect(lines).toHaveLength(4);
  });

  it('never includes another buyer’s escrows in the export (#1209)', async () => {
    const res = await request(server)
      .get('/buyer/escrows/export')
      .set('Authorization', bearer(BUYER_B))
      .expect(200);

    const lines = res.text.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('B-1');
  });
});
