import crypto from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';

const VENDOR_A = 'GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE';
const VENDOR_B = 'GB3LCRCZEETCBYV4PEIPV2PD2R3AJMC6S2OOBMV5MA6WCOKEMN3XA3K3';
const BUYER = 'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK';

describe('POST /escrow idempotency scoping (issue #397)', () => {
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

  it('gives two different vendors using the identical idempotency key their own escrow', async () => {
    const sharedKey = crypto.randomUUID();

    const responseA = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_A))
      .set('Idempotency-Key', sharedKey)
      .send({
        itemName: 'Vendor A item',
        itemRef: 'vendor-a-item',
        amount: 50,
        currency: 'USDC',
        buyerAddress: BUYER,
      })
      .expect(201);

    const responseB = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_B))
      .set('Idempotency-Key', sharedKey)
      .send({
        itemName: 'Vendor B item',
        itemRef: 'vendor-b-item',
        amount: 999,
        currency: 'USDC',
        buyerAddress: BUYER,
      })
      .expect(201);

    expect(responseB.body.id).not.toBe(responseA.body.id);
    expect(responseA.body.vendorAddress).toBe(VENDOR_A);
    expect(responseB.body.vendorAddress).toBe(VENDOR_B);
    expect(responseA.body.amount).toBe(50);
    expect(responseB.body.amount).toBe(999);
    expect(responseA.body.paymentUrl).not.toBe(responseB.body.paymentUrl);

    await expect(
      prisma.escrow.findUnique({ where: { id: responseA.body.id } }),
    ).resolves.toEqual(expect.objectContaining({ vendorAddress: VENDOR_A }));
    await expect(
      prisma.escrow.findUnique({ where: { id: responseB.body.id } }),
    ).resolves.toEqual(expect.objectContaining({ vendorAddress: VENDOR_B }));
  });

  it('returns the cached escrow when the same vendor reuses a key', async () => {
    const key = crypto.randomUUID();

    const first = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_A))
      .set('Idempotency-Key', key)
      .send({
        itemName: 'Repeatable item',
        itemRef: 'repeatable-item',
        amount: 42,
        currency: 'USDC',
        buyerAddress: BUYER,
      })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_A))
      .set('Idempotency-Key', key)
      .send({
        itemName: 'Repeatable item',
        itemRef: 'repeatable-item',
        amount: 42,
        currency: 'USDC',
        buyerAddress: BUYER,
      })
      .expect(201);

    expect(second.body).toEqual(first.body);

    const escrows = await prisma.escrow.findMany({
      where: { vendorAddress: VENDOR_A },
    });
    expect(escrows).toHaveLength(1);
  });

  it('rejects a non-UUID Idempotency-Key with 400', async () => {
    await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_A))
      .set('Idempotency-Key', 'not-a-uuid')
      .send({
        itemName: 'Some item',
        itemRef: 'some-item',
        amount: 10,
        currency: 'USDC',
        buyerAddress: BUYER,
      })
      .expect(400);
  });

  it('rejects a missing Idempotency-Key header with 400', async () => {
    await request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR_A))
      .send({
        itemName: 'Some item',
        itemRef: 'some-item-2',
        amount: 10,
        currency: 'USDC',
        buyerAddress: BUYER,
      })
      .expect(400);
  });
});
