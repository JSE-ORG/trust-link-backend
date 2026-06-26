import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/prisma/prisma.service';

type TestServer = Parameters<typeof request>[0];
type DisputesResponseBody = {
  total: number;
  data: Array<{ status: string }>;
  page: number;
  limit: number;
};

describe('GET /admin/disputes filters integration (issue #53)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let configService: ConfigService;
  let adminAddress: string;
  let jwtSecret: string;

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
    configService = app.get(ConfigService);
    adminAddress = configService.get('ADMIN_ADDRESS');
    jwtSecret = configService.get('SEP10_JWT_SECRET');
  });

  beforeEach(async () => {
    await prisma.reset();

    await prisma.escrow.create({
      data: {
        id: 'escrow-1',
        itemName: 'Item 1',
        itemRef: 'REF-1',
        amount: 100,
        currency: 'USDC',
        buyerAddress:
          'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2',
        vendorAddress:
          'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3',
        state: 'DISPUTED',
      },
    });

    await prisma.dispute.create({
      data: {
        id: 'dispute-1',
        escrowId: 'escrow-1',
        reason: 'ITEM_NOT_RECEIVED',
        description: 'Item was never delivered to my address',
        status: 'OPEN',
      },
    });

    await prisma.escrow.create({
      data: {
        id: 'escrow-2',
        itemName: 'Item 2',
        itemRef: 'REF-2',
        amount: 200,
        currency: 'USDC',
        buyerAddress:
          'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2',
        vendorAddress:
          'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3',
        state: 'DISPUTED',
      },
    });

    await prisma.dispute.create({
      data: {
        id: 'dispute-2',
        escrowId: 'escrow-2',
        reason: 'DAMAGED_ITEM',
        description: 'Item arrived damaged beyond repair',
        status: 'UNDER_REVIEW',
      },
    });

    await prisma.escrow.create({
      data: {
        id: 'escrow-3',
        itemName: 'Item 3',
        itemRef: 'REF-3',
        amount: 300,
        currency: 'USDC',
        buyerAddress:
          'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2',
        vendorAddress:
          'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3',
        state: 'COMPLETED',
      },
    });

    await prisma.dispute.create({
      data: {
        id: 'dispute-3',
        escrowId: 'escrow-3',
        reason: 'FRAUD',
        description: 'Seller misrepresented the product condition',
        status: 'RESOLVED',
        resolvedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  function signedJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  function adminJwt(): string {
    return signedJwt({ sub: adminAddress, role: 'admin' });
  }

  function vendorJwt(): string {
    return signedJwt({ sub: 'GVENDOR_ADDRESS', role: 'vendor' });
  }

  function httpServer(): TestServer {
    return app.getHttpServer() as TestServer;
  }

  it('returns all disputes when no filter is applied', async () => {
    const res = await request(httpServer())
      .get('/admin/disputes')
      .set('Authorization', `Bearer ${adminJwt()}`)
      .expect(200);
    const body = res.body as DisputesResponseBody;

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toContain(
      'max-age=31536000',
    );
    expect(body.total).toBe(3);
    expect(body.data).toHaveLength(3);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  it('filters disputes by status', async () => {
    const res = await request(httpServer())
      .get('/admin/disputes')
      .set('Authorization', `Bearer ${adminJwt()}`)
      .query({ status: 'OPEN' })
      .expect(200);
    const body = res.body as DisputesResponseBody;

    expect(body.total).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.status).toBe('OPEN');
  });

  it('paginates disputes correctly', async () => {
    const res = await request(httpServer())
      .get('/admin/disputes')
      .set('Authorization', `Bearer ${adminJwt()}`)
      .query({ page: 1, limit: 2 })
      .expect(200);
    const body = res.body as DisputesResponseBody;

    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(2);
  });

  it('returns 403 for non-admin users', async () => {
    await request(httpServer())
      .get('/admin/disputes')
      .set('Authorization', `Bearer ${vendorJwt()}`)
      .expect(403);
  });

  it('returns 401 for unauthenticated requests', async () => {
    await request(httpServer()).get('/admin/disputes').expect(401);
  });
});
