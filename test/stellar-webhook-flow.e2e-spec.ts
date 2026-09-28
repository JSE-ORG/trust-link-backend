import crypto from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as express from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { ensureVendors } from './prisma-helpers';

const VENDOR_ADDRESS = 'GWEBHOOKVENDOR001';
const BUYER_ADDRESS = 'GWEBHOOKBUYER001';
const WEBHOOK_SECRET = 'test-stellar-flow-secret';

describe('Stellar webhook escrow flow E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notifications: NotificationsService;

  const sign = (body: Buffer) =>
    crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

  beforeEach(async () => {
    process.env.STELLAR_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.use(
      '/webhooks/stellar',
      express.raw({ type: 'application/json' }),
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        const rawRequest = req as express.Request & { rawBody?: Buffer };
        if (Buffer.isBuffer(rawRequest.body)) {
          rawRequest.rawBody = Buffer.from(rawRequest.body);
          rawRequest.body = JSON.parse(rawRequest.rawBody.toString('utf8'));
        }
        next();
      },
    );
    await app.init();

    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    await prisma.reset();
    await ensureVendors(prisma, VENDOR_ADDRESS);
    jest.spyOn(notifications, 'notifyFunded').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    delete process.env.STELLAR_WEBHOOK_SECRET;
    await app.close();
  });

  async function createEscrow() {
    return prisma.escrow.create({
      data: {
        itemName: 'Webhook-funded item',
        itemRef: `stellar-webhook-${crypto.randomUUID()}`,
        amount: 100,
        currency: 'USDC',
        buyerAddress: BUYER_ADDRESS,
        vendorAddress: VENDOR_ADDRESS,
        state: 'CREATED',
      },
    });
  }

  function payload(id: string) {
    return {
      type: 'payment',
      id,
      transaction_hash: `tx-${id}`,
      to: VENDOR_ADDRESS,
      from: BUYER_ADDRESS,
      amount: '100',
      asset_code: 'USDC',
    };
  }

  function postWebhook(
    event: Record<string, unknown>,
    signature: string | undefined = sign(Buffer.from(JSON.stringify(event))),
  ) {
    const http = request(app.getHttpServer())
      .post('/webhooks/stellar')
      .set('Content-Type', 'application/json');
    if (signature !== undefined) http.set('x-stellar-signature', signature);
    return http.send(event);
  }

  it('changes escrow state through the public API for a correctly signed event', async () => {
    const escrow = await createEscrow();
    const response = await postWebhook(payload('stellar-op-valid'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });

    const publicEscrow = await request(app.getHttpServer())
      .get(`/escrow/${escrow.id}`)
      .expect(200);
    expect(publicEscrow.body.state).toBe('FUNDED');
  });

  it('rejects a badly signed event without changing the escrow', async () => {
    const escrow = await createEscrow();
    const response = await postWebhook(
      payload('stellar-op-invalid'),
      '00'.repeat(32),
    );

    expect(response.status).toBe(401);
    const publicEscrow = await request(app.getHttpServer())
      .get(`/escrow/${escrow.id}`)
      .expect(200);
    expect(publicEscrow.body.state).toBe('CREATED');
  });

  it('applies the same delivered event only once', async () => {
    const escrow = await createEscrow();
    const event = payload('stellar-op-duplicate');

    await postWebhook(event).expect(200);
    const duplicate = await postWebhook(event).expect(200);

    expect(duplicate.body).toEqual({
      received: true,
      skipped: true,
      reason: 'duplicate',
    });
    const publicEscrow = await request(app.getHttpServer())
      .get(`/escrow/${escrow.id}`)
      .expect(200);
    expect(publicEscrow.body.state).toBe('FUNDED');
    expect(
      await prisma.escrowEvent.count({ where: { escrowId: escrow.id } }),
    ).toBe(1);
  });
});
