import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

type TestServer = Parameters<typeof request>[0];

const VENDOR = 'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3';
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
    await ensureVendors(prisma, VENDOR);
    const rows: Array<[string, string, string]> = [
      ['A-1', 'Camera', BUYER_A],
      ['A-2', 'Lens', BUYER_A],
      ['B-1', '=HYPERLINK("http://x")', BUYER_B],
    ];
    for (const [itemRef, itemName, buyerAddress] of rows) {
      await prisma.escrow.create({
        data: {
          itemRef,
          itemName,
          buyerAddress,
          vendorAddress: VENDOR,
          amount: 100,
          currency: 'USDC',
          state: 'FUNDED',
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

    expect(a.body.total).toBe(2);
    expect(
      (a.body.data as Array<{ itemRef: string }>).map((e) => e.itemRef).sort(),
    ).toEqual(['A-1', 'A-2']);
    expect(b.body.total).toBe(1);
    expect(b.body.data[0].itemRef).toBe('B-1');
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
});
