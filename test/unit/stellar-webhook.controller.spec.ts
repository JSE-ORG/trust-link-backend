/**
 * Controller-level tests for POST /webhooks/stellar (issue #574).
 *
 * This is the only route in the API that accepts writes without a bearer
 * token — it relies solely on the shared `STELLAR_WEBHOOK_SECRET` HMAC.
 * `StellarWebhookService` already has unit and integration coverage, but
 * nothing previously exercised the controller itself: how it behaves when
 * `rawBody` is missing, when the signature header is absent, or when the
 * parsed body is `undefined` because the hand-rolled JSON parse in
 * `main.ts` failed.
 *
 * The raw-body capture lives in `main.ts`, outside any Nest module, so a
 * plain `Test.createTestingModule` will not reproduce it. This test
 * reapplies the same `express.raw` + manual-parse middleware used in
 * `main.ts` and in `stellar-webhook.integration-spec.ts`, directly on a
 * `createNestApplication()` instance, rather than driving the controller
 * method with a hand-built request object.
 *
 * `StellarWebhookService` is used for real (not mocked) so signature
 * verification is exercised as it actually runs in production, with its
 * own dependencies (`EscrowRepository`, `NotificationsService`) mocked out.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import * as express from 'express';
import request from 'supertest';
import { StellarWebhookController } from '../../src/webhooks/stellar-webhook.controller';
import { StellarWebhookService } from '../../src/webhooks/stellar-webhook.service';
import { ConfigService } from '../../src/config/config.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { NotificationsService } from '../../src/notifications/notifications.service';

describe('StellarWebhookController (issue #574)', () => {
  let app: INestApplication;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let notificationsService: jest.Mocked<NotificationsService>;

  const WEBHOOK_SECRET = 'unit-test-webhook-secret';

  const sign = (body: Buffer, secret: string): string =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  beforeEach(async () => {
    process.env.STELLAR_WEBHOOK_SECRET = WEBHOOK_SECRET;

    escrowRepository = {
      findByVendor: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<EscrowRepository>;

    notificationsService = {
      notify: jest.fn(),
    } as unknown as jest.Mocked<NotificationsService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [StellarWebhookController],
      providers: [
        StellarWebhookService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => process.env[key]) },
        },
        { provide: EscrowRepository, useValue: escrowRepository },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    // Replicate the raw-body middleware from main.ts, which the webhook
    // signature check depends on, since it is registered outside any
    // Nest module.
    app.use(
      '/webhooks/stellar',
      express.raw({ type: 'application/json' }),
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        const req2 = req as express.Request & { rawBody?: Buffer };
        if (Buffer.isBuffer(req2.body)) {
          req2.rawBody = Buffer.from(req2.body);
          try {
            req2.body = JSON.parse(req2.rawBody.toString('utf8')) as unknown;
          } catch {
            req2.body = undefined;
          }
        }
        next();
      },
    );

    await app.init();
  });

  afterEach(async () => {
    delete process.env.STELLAR_WEBHOOK_SECRET;
    await app.close();
  });

  function makePayload(overrides: Record<string, unknown> = {}) {
    return {
      type: 'account_created',
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      transaction_hash: `tx-${crypto.randomBytes(8).toString('hex')}`,
      ...overrides,
    };
  }

  describe('signature verification', () => {
    it('accepts a validly signed request', async () => {
      const payload = makePayload();
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

    it('rejects a request with an invalid signature', async () => {
      const payload = makePayload();
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const validSig = sign(body, WEBHOOK_SECRET);
      // Flip the signature so it no longer matches, without changing its length.
      const tamperedSig =
        validSig.slice(0, -1) + (validSig.endsWith('0') ? '1' : '0');

      await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', tamperedSig)
        .send(payload)
        .expect(401);
    });

    it('rejects a request with no signature header at all', async () => {
      const payload = makePayload();

      await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(401);
    });

    it('rejects a request signed for a different body', async () => {
      const payload = makePayload();
      const otherBody = Buffer.from(JSON.stringify(makePayload()), 'utf8');
      const sigForWrongBody = sign(otherBody, WEBHOOK_SECRET);

      await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', sigForWrongBody)
        .send(payload)
        .expect(401);
    });
  });

  describe('malformed body', () => {
    it('rejects malformed JSON cleanly (400) rather than a 500', async () => {
      const malformedText = '{not valid json';
      const sig = sign(Buffer.from(malformedText, 'utf8'), WEBHOOK_SECRET);

      const res = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .type('application/json')
        .set('x-stellar-signature', sig)
        .send(malformedText)
        .expect(400);

      expect(res.status).toBeLessThan(500);
    });
  });

  describe('idempotency', () => {
    it('handles a duplicate delivery of the same event without erroring', async () => {
      const payload = makePayload({ id: 'op-duplicate-check' });
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const sig = sign(body, WEBHOOK_SECRET);

      const first = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', sig)
        .send(payload)
        .expect(200);
      expect(first.body.received).toBe(true);
      expect(first.body.skipped).toBeUndefined();

      const second = await request(app.getHttpServer())
        .post('/webhooks/stellar')
        .set('Content-Type', 'application/json')
        .set('x-stellar-signature', sig)
        .send(payload)
        .expect(200);
      expect(second.body.received).toBe(true);
      expect(second.body.skipped).toBe(true);
      expect(second.body.reason).toBe('duplicate');
    });
  });
});
