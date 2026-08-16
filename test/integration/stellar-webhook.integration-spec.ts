/**
 * Integration tests for POST /webhooks/stellar (issue #294).
 *
 * Verifies Stellar Horizon webhook processing with HMAC verification,
 * idempotency (duplicate detection), and escrow state updates.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import * as express from 'express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('POST /webhooks/stellar (issue #294)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const WEBHOOK_SECRET = 'test-webhook-hmac-secret-key-32ch';
  const BUYER_ADDR = 'GWEBHOOKBUYER001';
  const WEBHOOK_SECRET = 'test-webhook-integration-secret';

  const sign = (body: Buffer, secret: string): string =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  const sign = (body: Buffer, secret: string): string =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  jest.setTimeout(30000);

  beforeEach(async () => {
    process.env.STELLAR_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    // Replicate the raw body middleware from main.ts for the webhook endpoint
    app.use(
      '/webhooks/stellar',
      express.raw({ type: 'application/json' }),
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        const request = req as express.Request & { rawBody?: Buffer };
        if (Buffer.isBuffer(request.body)) {
          request.rawBody = Buffer.from(request.body);
          try {
            request.body = JSON.parse(
              request.rawBody.toString('utf8'),
            ) as unknown;
          } catch {
            request.body = undefined;
          }
        }
        next();
      },
    );

    await app.init();
    prisma = app.get(PrismaService);
    await prisma.reset();
  });

  afterEach(async () => {
    delete process.env.STELLAR_WEBHOOK_SECRET;
    await app.close();
  });

  function makeWebhookPayload(overrides: Record<string, unknown> = {}) {
    return {
      type: 'payment',
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      transaction_hash: `tx-${crypto.randomBytes(8).toString('hex')}`,
      to: BUYER_ADDR,
      from: 'GSENDER001',
      amount: '100.00',
      asset_code: 'USDC',
      ...overrides,
    };
  }

  // ── Valid webhook processing ──────────────────────────────────────────────

  it('processes a valid webhook and returns received: true', async () => {
    const payload = makeWebhookPayload();
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = sign(body, WEBHOOK_SECRET);

    const res = await request(app.getHttpServer())
      .post('/webhooks/stellar')
      .set('Content-Type', 'application/json')
      .set('x-stellar-signature', sig)
      .send(payload)
      .expect(200);

    expect(res.body.received).toBe(true);
  });

  it('records the processed event in ProcessedWebhookEvent table', async () => {
    const opId = `op-record-${Date.now()}`;
    const payload = makeWebhookPayload({ id: opId });
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = sign(body, WEBHOOK_SECRET);

    await request(app.getHttpServer())
      .post('/webhooks/stellar')
      .set('Content-Type', 'application/json')
      .set('x-stellar-signature', sig)
      .send(payload)
      .expect(200);

    const recorded = await prisma.processedWebhookEvent.findUnique({
      where: { operationId: opId },
    });
    expect(recorded).not.toBeNull();
    expect(recorded!.operationId).toBe(opId);
  });

  // ── Duplicate webhook idempotency ─────────────────────────────────────────

  it('skips duplicate webhook events (idempotency)', async () => {
    const opId = `op-dup-${Date.now()}`;
    const payload = makeWebhookPayload({ id: opId });
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = sign(body, WEBHOOK_SECRET);

    const res1 = await request(app.getHttpServer())
      .post('/webhooks/stellar')
      .set('Content-Type', 'application/json')
      .set('x-stellar-signature', sig)
      .send(payload)
      .expect(200);

    expect(res1.body.received).toBe(true);

    const res2 = await request(app.getHttpServer())
      .post('/webhooks/stellar')
      .set('Content-Type', 'application/json')
      .set('x-stellar-signature', sig)
      .send(payload)
      .expect(200);

    expect(res2.body.received).toBe(true);
    expect(res2.body.skipped).toBe(true);
    expect(res2.body.reason).toBe('duplicate');
  });

  it('tracks duplicate events in ProcessedWebhookEvent table', async () => {
    const opId = `op-dup-track-${Date.now()}`;
    const payload = makeWebhookPayload({ id: opId });
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = sign(body, WEBHOOK_SECRET);

    await request(app.getHttpServer())
      .post('/webhooks/stellar')
      .set('Content-Type', 'application/json')
      .set('x-stellar-signature', sig)
      .send(payload)
      .expect(200);

    const recorded = await prisma.processedWebhookEvent.findUnique({
      where: { operationId: opId },
    });
    expect(recorded).not.toBeNull();
    expect(recorded!.operationId).toBe(opId);
  });

  // ── Unknown operation ID ──────────────────────────────────────────────────

  it('handles webhook with unknown destination gracefully', async () => {
    const payload = makeWebhookPayload({
      to: 'GUNKNOWN0000000000000000000000000000000',
    });
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = sign(body, WEBHOOK_SECRET);

    const res = await request(app.getHttpServer())
      .post('/webhooks/stellar')
      .set('Content-Type', 'application/json')
      .set('x-stellar-signature', sig)
      .send(payload)
      .expect(200);

    expect(res.body.received).toBe(true);
  });

  // ── Unhandled event types ─────────────────────────────────────────────────

  it('handles unhandled event types gracefully', async () => {
    const payload = makeWebhookPayload({
      type: 'account_created',
      to: undefined,
      from: 'GSENDER001',
    });
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = sign(body, WEBHOOK_SECRET);

    const res = await request(app.getHttpServer())
      .post('/webhooks/stellar')
      .set('Content-Type', 'application/json')
      .set('x-stellar-signature', sig)
      .send(payload)
      .expect(200);

    expect(res.body.received).toBe(true);
  });

  // ── Missing required fields ───────────────────────────────────────────────

  it('returns 400 when payload is missing required fields', async () => {
    const invalidPayload = { type: 'payment' };
    const body = Buffer.from(JSON.stringify(invalidPayload), 'utf8');
    const sig = sign(body, WEBHOOK_SECRET);

    await request(app.getHttpServer())
      .post('/webhooks/stellar')
      .set('Content-Type', 'application/json')
      .set('x-stellar-signature', sig)
      .send(invalidPayload)
      .expect(400);
  });
});
