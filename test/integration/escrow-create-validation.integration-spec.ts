import crypto from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bearer } from '../auth-helper';
import { ensureVendors } from '../prisma-helpers';

const VENDOR = 'GA36PERSXWPBG7HYKNBVT5PFLTOFYO4Q3CWGJZTYH5GU5OLTKHW7SJHE';
const BUYER = 'GADRXQS5ZCXLBX6U67CY2WBJNDUXCWGHSQKR76AOJDQECYX36W5S6IYK';

const validBody = {
  itemName: 'Validated item',
  itemRef: 'validated-item',
  amount: 10,
  currency: 'USDC',
  buyerAddress: BUYER,
};

describe('POST /escrow input validation (issues #933, #934)', () => {
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
    await ensureVendors(prisma, VENDOR);
  });

  afterEach(async () => {
    await app.close();
  });

  function createEscrow(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/escrow')
      .set('Authorization', bearer(VENDOR))
      .set('Idempotency-Key', crypto.randomUUID())
      .send(body);
  }

  it('creates an escrow with 8 decimal places', async () => {
    await createEscrow({ ...validBody, amount: 0.12345678 }).expect(201);
  });

  it('rejects an amount with more than 8 decimal places with 400', async () => {
    await createEscrow({ ...validBody, amount: 0.123456789 }).expect(400);
  });

  it('rejects an amount too large for Decimal(18, 8) with 400', async () => {
    await createEscrow({ ...validBody, amount: 1e12 }).expect(400);
  });

  it('rejects an itemRef longer than 100 characters with 400', async () => {
    await createEscrow({ ...validBody, itemRef: 'a'.repeat(101) }).expect(400);
  });

  it('stores a trimmed itemRef', async () => {
    const res = await createEscrow({
      ...validBody,
      itemRef: '  padded-ref  ',
    }).expect(201);

    expect(res.body.itemRef).toBe('padded-ref');
  });

  it('rejects an escrow where the vendor is the buyer with 400', async () => {
    await createEscrow({ ...validBody, buyerAddress: VENDOR }).expect(400);

    await expect(
      prisma.escrow.count({ where: { vendorAddress: VENDOR } }),
    ).resolves.toBe(0);
  });
});
