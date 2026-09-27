import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { SENDGRID_CLIENT, TWILIO_CLIENT } from './notifications.tokens';
import {
  EscrowRecord,
  PrismaService,
  toEscrowRecord,
} from '../prisma/prisma.service';
import { ensureVendors } from '../../test/prisma-helpers';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: PrismaService;
  let sendGrid: { send: jest.Mock };
  let twilio: { messages: { create: jest.Mock } };

  let escrow: EscrowRecord = {
    id: 'escrow-1',
    contractEscrowId: null,
    itemName: 'Widget',
    itemRef: 'ref-1',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'GBUYER',
    vendorAddress: 'GVENDOR',
    state: 'FUNDED',
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    sendGrid = { send: jest.fn().mockResolvedValue([{ headers: {} }]) };
    twilio = {
      messages: { create: jest.fn().mockResolvedValue({ sid: 'SM123' }) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        PrismaService,
        { provide: SENDGRID_CLIENT, useValue: sendGrid },
        { provide: TWILIO_CLIENT, useValue: twilio },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
    prisma = moduleRef.get(PrismaService);

    await prisma.reset();
    await ensureVendors(prisma, escrow.vendorAddress);
    escrow = toEscrowRecord(
      await prisma.escrow.create({
        data: {
          itemName: escrow.itemName,
          itemRef: escrow.itemRef,
          amount: escrow.amount,
          currency: escrow.currency,
          buyerAddress: escrow.buyerAddress,
          vendorAddress: escrow.vendorAddress,
          state: escrow.state,
        },
      }),
    );

    // Prevent actual timer delays in all tests
    jest
      .spyOn(service, 'sleep' as keyof NotificationsService)
      .mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    jest.restoreAllMocks();
  });

  describe('notification message formatting and required fields (#240)', () => {
    it('creates a notification record with the message field set', async () => {
      await service.notifyFunded(escrow);

      const notifications = await prisma.notification.findMany();
      expect(notifications.length).toBeGreaterThan(0);

      const record = notifications[0];
      expect(record.message).toBeDefined();
      expect(record.message).toBe(`FUNDED: ${escrow.itemName}`);
    });

    it('sets all required fields (message, escrowId, type, channel, recipientAddress)', async () => {
      await service.notifyFunded(escrow);

      const notifications = await prisma.notification.findMany();
      const record = notifications[0];

      expect(record.escrowId).toBe(escrow.id);
      expect(record.type).toBe('FUNDED');
      expect(record.channel).toMatch(/^(EMAIL|SMS)$/);
      expect(record.recipientAddress).toBe(escrow.vendorAddress);
      expect(record.message).toBeTruthy();
    });

    it('creates a notification record with message field for SMS channel', async () => {
      await service.notifyDisputed(escrow);

      const notifications = await prisma.notification.findMany();
      const smsRecord = notifications.find((n) => n.channel === 'SMS');

      expect(smsRecord).toBeDefined();
      expect(smsRecord!.message).toBe(`DISPUTED: ${escrow.itemName}`);
    });
  });

  describe('happy-path dispatch behaviour (#18, #288)', () => {
    it('notifyFunded calls SendGrid and Twilio with the funded template', async () => {
      await service.notifyFunded(escrow);

      expect(sendGrid.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: escrow.vendorAddress,
          templateId: 'trustlink-funded',
        }),
      );
      expect(twilio.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ to: escrow.vendorAddress }),
      );
    });

    it('dispatches SMS via Twilio and records providerMessageId', async () => {
      await service.notifyShipped(escrow);

      expect(twilio.messages.create).toHaveBeenCalledTimes(1);
      expect(twilio.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ to: escrow.buyerAddress }),
      );

      const notifications = await prisma.notification.findMany();
      const smsRecord = notifications.find((n) => n.channel === 'SMS');
      expect(smsRecord).toBeDefined();
      expect(smsRecord!.type).toBe('SHIPPED');
      expect(smsRecord!.providerMessageId).toBe('SM123');
    });

    it('creates a notification record for each dispatch', async () => {
      await service.notifyFunded(escrow);

      const records = await prisma.notification.findMany();
      expect(records).toHaveLength(2);
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ channel: 'EMAIL', type: 'FUNDED' }),
          expect.objectContaining({ channel: 'SMS', type: 'FUNDED' }),
        ]),
      );
    });

    it('supports all escrow notification event types and stores records', async () => {
      await service.notifyFunded(escrow);
      await service.notifyShipped(escrow);
      await service.notifyDelivered(escrow);
      await service.notifyDisputed(escrow);
      await service.notifyCompleted(escrow);
      await service.notifyRefunded(escrow);

      const records = await prisma.notification.findMany();
      expect(records).toHaveLength(12);
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'DELIVERED' }),
          expect.objectContaining({ type: 'DISPUTED' }),
          expect.objectContaining({ type: 'COMPLETED' }),
          expect.objectContaining({ type: 'REFUNDED' }),
        ]),
      );
    });

    it('uses vendor for funded notifications and buyer for shipped notifications', async () => {
      await service.notifyFunded(escrow);
      await service.notifyShipped({ ...escrow, state: 'SHIPPED' });

      const recipients = (await prisma.notification.findMany()).map(
        (record) => record.recipientAddress,
      );
      expect(recipients).toEqual([
        escrow.vendorAddress,
        escrow.vendorAddress,
        escrow.buyerAddress,
        escrow.buyerAddress,
      ]);
    });

    it('is a no-op (noop provider) when SendGrid is not configured', async () => {
      const serviceNoSendgrid = new NotificationsService(
        prisma,
        undefined,
        twilio,
      );

      await expect(
        serviceNoSendgrid.notifyFunded(escrow),
      ).resolves.toBeUndefined();

      const notifications = await prisma.notification.findMany();
      const emailRecord = notifications.find((n) => n.channel === 'EMAIL');
      expect(emailRecord).toBeDefined();
      expect(emailRecord!.attemptCount).toBe(1);
    });

    it('is a no-op (noop provider) when Twilio is not configured', async () => {
      const serviceNoTwilio = new NotificationsService(
        prisma,
        sendGrid,
        undefined,
      );

      await expect(
        serviceNoTwilio.notifyDisputed(escrow),
      ).resolves.toBeUndefined();

      const notifications = await prisma.notification.findMany();
      const smsRecord = notifications.find((n) => n.channel === 'SMS');
      expect(smsRecord).toBeDefined();
      expect(smsRecord!.attemptCount).toBe(1);
    });
  });

  describe('retry behaviour (#18, #288)', () => {
    it('retries up to 3 times on transient provider failure then resolves', async () => {
      sendGrid.send
        .mockRejectedValueOnce(new Error('upstream down'))
        .mockRejectedValueOnce(new Error('upstream down'))
        .mockResolvedValueOnce([{ headers: {} }]);
      twilio.messages.create
        .mockRejectedValueOnce(new Error('upstream down'))
        .mockRejectedValueOnce(new Error('upstream down'))
        .mockResolvedValueOnce({ sid: 'SM2' });

      await expect(service.notifyShipped(escrow)).resolves.toBeUndefined();

      expect(sendGrid.send).toHaveBeenCalledTimes(3);
      expect(twilio.messages.create).toHaveBeenCalledTimes(3);
    });

    it('records attemptCount=1 on first-attempt success', async () => {
      await service.notifyFunded(escrow);

      const records = await prisma.notification.findMany();
      for (const r of records) {
        expect(r.attemptCount).toBe(1);
      }
    });

    it('records attemptCount=2 when second attempt succeeds', async () => {
      sendGrid.send
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce([{ headers: {} }]);
      twilio.messages.create
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({ sid: 'SM3' });

      await service.notifyFunded(escrow);

      const records = await prisma.notification.findMany();
      for (const r of records) {
        expect(r.attemptCount).toBe(2);
      }
    });

    it('records attemptCount=3 after exhausting all retries', async () => {
      sendGrid.send.mockRejectedValue(new Error('persistent failure'));
      twilio.messages.create.mockRejectedValue(new Error('persistent failure'));

      await service.notifyFunded(escrow);

      const records = await prisma.notification.findMany();
      for (const r of records) {
        expect(r.attemptCount).toBe(3);
      }
    });

    it('applies exponentially increasing delays between retries', async () => {
      const sleepSpy = jest.spyOn(
        service,
        'sleep' as keyof NotificationsService,
      );
      sendGrid.send
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce([{ headers: {} }]);
      twilio.messages.create.mockResolvedValue({ sid: 'SM1' });

      await service.notifyFunded(escrow);

      const emailSleepCalls = sleepSpy.mock.calls.filter((_, i) => i < 2);
      expect(emailSleepCalls[0][0]).toBe(1000);
      expect(emailSleepCalls[1][0]).toBe(2000);
    });

    it('catches provider failures and logs without throwing', async () => {
      sendGrid.send.mockRejectedValue(new Error('sendgrid down'));
      twilio.messages.create.mockRejectedValue(new Error('twilio down'));

      await expect(service.notifyFunded(escrow)).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalledTimes(2);
    });
  });

  describe('response-code logging (#18, #288)', () => {
    it('logs HTTP response code from provider error into the notification record', async () => {
      const httpError = Object.assign(new Error('rate limited'), { code: 429 });
      sendGrid.send.mockRejectedValue(httpError);
      twilio.messages.create.mockRejectedValue(httpError);

      await service.notifyFunded(escrow);

      const records = await prisma.notification.findMany();
      for (const r of records) {
        expect(r.lastResponseCode).toBe(429);
      }
    });

    it('stores null response code when provider error carries no status', async () => {
      sendGrid.send.mockRejectedValue(new Error('unknown error'));
      twilio.messages.create.mockRejectedValue(new Error('unknown error'));

      await service.notifyFunded(escrow);

      const records = await prisma.notification.findMany();
      for (const r of records) {
        expect(r.lastResponseCode).toBeNull();
      }
    });

    it('logs response code from nested error.response.statusCode', async () => {
      const nestedError = Object.assign(new Error('server error'), {
        response: { statusCode: 503 },
      });
      sendGrid.send.mockRejectedValue(nestedError);
      twilio.messages.create.mockRejectedValue(nestedError);

      await service.notifyFunded(escrow);

      const records = await prisma.notification.findMany();
      for (const r of records) {
        expect(r.lastResponseCode).toBe(503);
      }
    });
  });
});

// ── Issue #726 — channel selection + provider error parsing ──────────────────

import * as contactEncryption from '../common/sanitization/contact-encryption.util';

describe('NotificationsService (#726) — channel selection', () => {
  // Uses an in-memory prisma stub — no Postgres required.
  // The stub captures notification.create calls so we can inspect which
  // channels were dispatched and what recipientAddress was used.

  const makeStubEscrow = (
    overrides: Partial<EscrowRecord> = {},
  ): EscrowRecord => ({
    id: 'escrow-726',
    itemName: 'Widget',
    itemRef: 'ref-726',
    amount: 50,
    currency: 'USDC',
    buyerAddress: 'GBUYER726',
    vendorAddress: 'GVENDOR',
    state: 'SHIPPED',
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    contractEscrowId: null,
    buyerContactEmail: null,
    buyerContactPhone: null,
    ...overrides,
  });

  function makeStubPrisma() {
    const created: Array<Record<string, unknown>> = [];
    return {
      stubPrisma: {
        notification: {
          create: jest
            .fn()
            .mockImplementation(
              ({ data }: { data: Record<string, unknown> }) => {
                created.push(data);
                return Promise.resolve(data);
              },
            ),
          findMany: jest
            .fn()
            .mockImplementation(() => Promise.resolve(created)),
        },
      } as unknown as PrismaService,
      created,
    };
  }

  let service: NotificationsService;
  let created: Array<Record<string, unknown>>;

  beforeEach(() => {
    const stub = makeStubPrisma();
    created = stub.created;
    service = new NotificationsService(stub.stubPrisma);
    jest
      .spyOn(service, 'sleep' as keyof NotificationsService)
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends only EMAIL when only buyerContactEmail resolves', async () => {
    // Supply a non-null stored value so tryDecrypt actually calls decryptContact
    const escrow = makeStubEscrow({
      buyerContactEmail: 'encrypted-email',
      buyerContactPhone: 'encrypted-phone',
    });

    jest
      .spyOn(contactEncryption, 'decryptContact')
      .mockImplementationOnce(() => 'buyer@example.com') // email succeeds
      .mockImplementationOnce(() => {
        throw new Error('bad phone');
      }); // phone fails

    await service.notifyShipped(escrow);

    const channels = created.map((n) => n.channel);
    expect(channels).toContain('EMAIL');
    expect(channels).not.toContain('SMS');

    const emailRecord = created.find((n) => n.channel === 'EMAIL');
    expect(emailRecord!.recipientAddress).toBe('buyer@example.com');
  });

  it('sends only SMS when only buyerContactPhone resolves', async () => {
    const escrow = makeStubEscrow({
      buyerContactEmail: 'encrypted-email',
      buyerContactPhone: 'encrypted-phone',
    });

    jest
      .spyOn(contactEncryption, 'decryptContact')
      .mockImplementationOnce(() => {
        throw new Error('bad email');
      }) // email fails
      .mockImplementationOnce(() => '+15550001234'); // phone succeeds

    await service.notifyShipped(escrow);

    const channels = created.map((n) => n.channel);
    expect(channels).toContain('SMS');
    expect(channels).not.toContain('EMAIL');

    const smsRecord = created.find((n) => n.channel === 'SMS');
    expect(smsRecord!.recipientAddress).toBe('+15550001234');
  });

  it('falls back to Stellar buyerAddress when neither email nor phone resolves, and writes a notification row', async () => {
    // No stored contact fields — tryDecrypt returns null immediately without
    // calling decryptContact, so the no-contact branch is exercised.
    const escrow = makeStubEscrow({ buyerAddress: 'GBUYER_NO_CONTACT' });

    await service.notifyShipped(escrow);

    // dispatch() sends both EMAIL and SMS to the Stellar address
    expect(created.length).toBeGreaterThanOrEqual(1);
    for (const n of created) {
      expect(n.recipientAddress).toBe('GBUYER_NO_CONTACT');
    }
  });
});

describe('NotificationsService (#726) — extractResponseCode shapes', () => {
  // These tests exercise pure parsing logic — no database required.
  // A minimal prisma stub captures whatever lastResponseCode the service
  // computes and stores, without touching Postgres.

  const stubEscrow: EscrowRecord = {
    id: 'escrow-726-err',
    itemName: 'Widget',
    itemRef: 'ref-726-err',
    amount: 50,
    currency: 'USDC',
    buyerAddress: 'GBUYER726ERR',
    vendorAddress: 'GVENDOR',
    state: 'FUNDED',
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    contractEscrowId: null,
  };

  function makeStubPrisma() {
    // Captures the `data` passed to notification.create so tests can inspect it.
    const created: Array<Record<string, unknown>> = [];
    const stubPrisma = {
      notification: {
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return Promise.resolve(data);
          }),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { channel?: string } }) =>
            Promise.resolve(
              created.find((r) => r.channel === where.channel) ?? null,
            ),
          ),
      },
    } as unknown as PrismaService;
    return { stubPrisma, created };
  }

  function makeSvc(error: unknown) {
    const { stubPrisma, created } = makeStubPrisma();
    const sendGrid = { send: jest.fn().mockRejectedValue(error) };
    const svc = new NotificationsService(stubPrisma, sendGrid);
    jest
      .spyOn(svc, 'sleep' as keyof NotificationsService)
      .mockResolvedValue(undefined);
    return { svc, created };
  }

  afterEach(() => jest.restoreAllMocks());

  it('extracts status code from e.status (SendGrid-style top-level status)', async () => {
    const { svc, created } = makeSvc({ status: 403 });
    await svc.notifyFunded(stubEscrow);
    const email = created.find((r) => r.channel === 'EMAIL');
    expect(email!.lastResponseCode).toBe(403);
  });

  it('extracts status code from e.response.statusCode (SendGrid-style nested statusCode)', async () => {
    const { svc, created } = makeSvc({ response: { statusCode: 422 } });
    await svc.notifyFunded(stubEscrow);
    const email = created.find((r) => r.channel === 'EMAIL');
    expect(email!.lastResponseCode).toBe(422);
  });

  it('extracts status code from e.response.status (Twilio/Axios-style nested status)', async () => {
    const { svc, created } = makeSvc({ response: { status: 429 } });
    await svc.notifyFunded(stubEscrow);
    const email = created.find((r) => r.channel === 'EMAIL');
    expect(email!.lastResponseCode).toBe(429);
  });

  it('returns null when error is not an object (primitive throw)', async () => {
    // Throwing a string — the guard `typeof error === 'object'` is false
    const { svc, created } = makeSvc('network timeout');
    await svc.notifyFunded(stubEscrow);
    const email = created.find((r) => r.channel === 'EMAIL');
    expect(email!.lastResponseCode).toBeNull();
  });
});
