import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { LogisticsService } from '../../src/logistics/logistics.service';

describe('GET /escrow/:id/tracking integration (issue #54)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const vendorAddress = 'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3';
  const buyerAddress = 'GDAMQCBXJI72A6R4QOTF6BJTXVLE5P7G2RT7ADADDB4UKMILJ3YF77F2';

  const uuid1 = '00000000-0000-4000-8000-000000000001';
  const uuid2 = '00000000-0000-4000-8000-000000000002';
  const uuid3 = '00000000-0000-4000-8000-000000000003';
  const nonExistentUuid = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LogisticsService)
      .useValue({
        getStatus: jest.fn().mockResolvedValue({ status: 'IN_TRANSIT' }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with tracking status when escrow has trackingId', async () => {
    await prisma.escrow.create({
      data: {
        id: uuid1,
        itemName: 'Tracked Package',
        itemRef: 'TRACK-001',
        amount: 100,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'SHIPPED',
        trackingId: 'TRACK123',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/escrow/${uuid1}/tracking`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({ status: 'IN_TRANSIT' }),
    );
  });

  it('returns 404 when escrow has no trackingId', async () => {
    await prisma.escrow.create({
      data: {
        id: uuid2,
        itemName: 'No Tracking Item',
        itemRef: 'NOTRACK-001',
        amount: 50,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'FUNDED',
      },
    });

    await request(app.getHttpServer())
      .get(`/escrow/${uuid2}/tracking`)
      .expect(404);
  });

  it('returns 404 for non-existent escrow', async () => {
    await request(app.getHttpServer())
      .get(`/escrow/${nonExistentUuid}/tracking`)
      .expect(404);
  });

  it('returns cached tracking result on second call', async () => {
    await prisma.escrow.create({
      data: {
        id: uuid3,
        itemName: 'Cached Package',
        itemRef: 'CACHE-001',
        amount: 200,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'SHIPPED',
        trackingId: 'CACHE123',
      },
    });

    const res1 = await request(app.getHttpServer())
      .get(`/escrow/${uuid3}/tracking`)
      .expect(200);

    expect(res1.body.cached).toBe(false);

    const res2 = await request(app.getHttpServer())
      .get(`/escrow/${uuid3}/tracking`)
      .expect(200);

    expect(res2.body.cached).toBe(true);
  });
});
