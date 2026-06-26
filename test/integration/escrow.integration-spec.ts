/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('POST /escrow integration (issue #20)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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

  it('creates a DB record and returns 201 for a valid request', async () => {
    const response = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', 'Bearer vendor-address')
      .send({
        itemName: 'Vintage jacket',
        itemRef: 'jacket-001',
        amount: 75,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
      })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        itemName: 'Vintage jacket',
        itemRef: 'jacket-001',
        amount: 75,
        vendorAddress: 'vendor-address',
        buyerAddress: 'buyer-address',
        state: 'FUNDED',
        paymentUrl: expect.stringContaining('/pay/'),
      }),
    );
    await expect(
      prisma.escrow.findUnique({ where: { id: response.body.id } }),
    ).resolves.toEqual(expect.objectContaining({ id: response.body.id }));
  });

  it('returns 400 with validation errors for missing required fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', 'Bearer vendor-address')
      .send({ itemName: 'Hat' })
      .expect(400);

    expect(response.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('itemRef'),
        expect.stringContaining('amount'),
        expect.stringContaining('currency'),
        expect.stringContaining('buyerAddress'),
      ]),
    );
  });

  it('returns 401 for unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/escrow')
      .send({
        itemName: 'Vintage jacket',
        amount: 75,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
      })
      .expect(401);
  });

  it('retrieves a created escrow via GET /escrow/:id without authentication', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', 'Bearer vendor-address')
      .send({
        itemName: 'Vintage jacket',
        itemRef: 'jacket-001',
        amount: 75,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/escrow/${createResponse.body.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            id: createResponse.body.id,
            itemName: 'Vintage jacket',
            itemRef: 'jacket-001',
          }),
        );
        expect(response.body).not.toHaveProperty('vendorAddress');
        expect(response.body).not.toHaveProperty('buyerAddress');
      });
  });

  it('returns paginated vendor escrows with state filtering and sorting', async () => {
    await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', 'Bearer vendor-address')
      .send({
        itemName: 'Vintage jacket',
        itemRef: 'jacket-001',
        amount: 75,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', 'Bearer vendor-address')
      .send({
        itemName: 'Leather bag',
        itemRef: 'bag-001',
        amount: 120,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', 'Bearer other-vendor')
      .send({
        itemName: 'Sneakers',
        itemRef: 'sneaker-001',
        amount: 150,
        currency: 'USDC',
        buyerAddress: 'buyer-address',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/vendor/escrows')
      .set('Authorization', 'Bearer vendor-address')
      .query({
        state: 'FUNDED',
        sort: 'amount',
        order: 'desc',
        page: 1,
        limit: 2,
      })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        total: 2,
        page: 1,
        limit: 2,
      }),
    );
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].amount).toBeGreaterThanOrEqual(
      response.body.data[1].amount,
    );
    expect(response.body.data.every((item: any) => item.id !== undefined)).toBe(
      true,
    );
  });
});
