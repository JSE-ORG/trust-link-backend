/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ContractService } from '../../src/stellar/contract.service';

/**
 * Issue #276 — Integration tests for webhook HMAC signature rejection.
 *
 * Verifies that the POST /webhooks/stellar endpoint properly validates
 * HMAC-SHA256 signatures through the full HTTP layer, rejecting tampered
 * payloads and missing signatures with clear error messages.
 */
describe('Webhook HMAC signature rejection (issue #276)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const WEBHOOK_SECRET = 'test-webhook-hmac-secret-key-32ch';

  const makePayload = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    type: 'payment',
    id: 'op-hmac-001',
    transaction_hash: 'tx-hmac-abc123',
    to: 'GBUYER_HMAC',
    from: 'GSENDER_HMAC',
    amount: '100.00',
    asset_code: 'USDC',
    ...overrides,
  });

  const sign = (body: Buffer, secret: string): string =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  beforeAll(async () => {
    process.env.STELLAR_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ContractService)
      .useValue({
        submitAutoRelease: jest.fn().mockResolvedValue('mock-tx-hash'),
        resolveDispute: jest.fn().mockResolvedValue('mock-tx-hash'),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.reset();
  });

  afterAll(async () => {
    delete process.env.STELLAR_WEBHOOK_SECRET;
    await app.close();
  });

  // ── Valid signatures pass ─────────────────────────────────────────────────

  describe('valid HMAC signature', () => {
    it('accepts a request with a valid HMAC-SHA256 signature', async () => {
      const payload = makePayload({ id: 'op-valid-001' });
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const sig = sign(body, WEBHOOK_SECRET);

      const res = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', sig)
        .send(payload)
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({ received: true }),
      );
    });
  });

  // ── Tampered payloads are rejected ────────────────────────────────────────

  describe('tampered payload', () => {
    it('rejects a request where the body was modified after signing', async () => {
      const originalPayload = makePayload({ id: 'op-tamper-001', amount: '50.00' });
      const originalBody = Buffer.from(JSON.stringify(originalPayload), 'utf8');
      const sig = sign(originalBody, WEBHOOK_SECRET);

      // Tamper with the amount in the actual request body
      const tamperedPayload = makePayload({ id: 'op-tamper-001', amount: '9999.00' });

      const res = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', sig)
        .send(tamperedPayload)
        .expect(401);

      expect(res.body.message).toBe('Invalid webhook signature');
    });

    it('rejects a request signed with a different secret', async () => {
      const payload = makePayload({ id: 'op-wrongsecret-001' });
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const sig = sign(body, 'attacker-different-secret-key!!');

      const res = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', sig)
        .send(payload)
        .expect(401);

      expect(res.body.message).toBe('Invalid webhook signature');
    });
  });

  // ── Missing signature is rejected ─────────────────────────────────────────

  describe('missing signature', () => {
    it('rejects a request with no X-Stellar-Signature header', async () => {
      const payload = makePayload({ id: 'op-nosig-001' });

      const res = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(401);

      expect(res.body.message).toBe(
        'Missing X-Stellar-Signature header',
      );
    });

    it('rejects a request with an empty signature header', async () => {
      const payload = makePayload({ id: 'op-emptysig-001' });

      const res = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', '')
        .send(payload)
        .expect(401);

      expect(res.body.message).toBe(
        'Missing X-Stellar-Signature header',
      );
    });
  });

  // ── Error messages are clear ──────────────────────────────────────────────

  describe('error message clarity', () => {
    it('returns a clear error for invalid signature', async () => {
      const payload = makePayload({ id: 'op-errmsg-001' });

      const res = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', 'deadbeef')
        .send(payload)
        .expect(401);

      expect(res.body).toHaveProperty('message');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
    });

    it('returns a clear error for missing signature', async () => {
      const payload = makePayload({ id: 'op-errmsg-002' });

      const res = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(401);

      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('Missing');
    });
  });

  // ── Duplicate events are idempotent ───────────────────────────────────────

  describe('idempotency after valid signature', () => {
    it('processes the same event only once (deduplication)', async () => {
      const payload = makePayload({ id: 'op-dup-001' });
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const sig = sign(body, WEBHOOK_SECRET);

      const res1 = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', sig)
        .send(payload)
        .expect(200);

      expect(res1.body.received).toBe(true);
      expect(res1.body.skipped).toBeUndefined();

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
  });
});
