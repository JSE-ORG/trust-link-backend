/* eslint-disable @typescript-eslint/unbound-method */
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationsService } from '../../src/notifications/notifications.service';
import {
  SENDGRID_CLIENT,
  TWILIO_CLIENT,
} from '../../src/notifications/notifications.tokens';
import { EscrowRecord, PrismaService } from '../../src/prisma/prisma.service';

describe('NotificationsService (issue #18)', () => {
  let service: NotificationsService;
  let prisma: PrismaService;
  let sendGrid: { send: jest.Mock };
  let twilio: { messages: { create: jest.Mock } };

  const escrow: EscrowRecord = {
    id: 'escrow-1',
    itemName: 'Vintage jacket',
    itemRef: 'jacket-001',
    amount: 80,
    currency: 'USDC',
    buyerAddress: 'buyer-address',
    vendorAddress: 'vendor-address',
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
      messages: { create: jest.fn().mockResolvedValue({ sid: 'SM1' }) },
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

    // Prevent actual timer delays in all tests
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── happy-path behaviour ──────────────────────────────────────────────────

  it('notifyFunded calls SendGrid and Twilio with the funded template', async () => {
    await service.notifyFunded(escrow);

    expect(sendGrid.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'vendor-address',
        templateId: 'trustlink-funded',
      }),
    );
    expect(twilio.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'vendor-address' }),
    );
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
      'vendor-address',
      'vendor-address',
      'buyer-address',
      'buyer-address',
    ]);
  });

  // ── retry behaviour ───────────────────────────────────────────────────────

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

  it('records attemptCount=3 after exhausting all retries', async () => {
    sendGrid.send.mockRejectedValue(new Error('persistent failure'));
    twilio.messages.create.mockRejectedValue(new Error('persistent failure'));

    await service.notifyFunded(escrow);

    const records = await prisma.notification.findMany();
    for (const r of records) {
      expect(r.attemptCount).toBe(3);
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

  it('applies exponentially increasing delays between retries', async () => {
    const sleepSpy = jest.spyOn(service as any, 'sleep');
    sendGrid.send
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce([{ headers: {} }]);
    twilio.messages.create.mockResolvedValue({ sid: 'SM1' });

    await service.notifyFunded(escrow);

    // First delay: 1000ms (2^0 * 1000), second: 2000ms (2^1 * 1000)
    const emailSleepCalls = sleepSpy.mock.calls.filter((_, i) => i < 2);
    expect(emailSleepCalls[0][0]).toBe(1000);
    expect(emailSleepCalls[1][0]).toBe(2000);
  });

  it('catches provider failures and logs without throwing', async () => {
    sendGrid.send.mockRejectedValue(new Error('sendgrid down'));
    twilio.messages.create.mockRejectedValue(new Error('twilio down'));

    await expect(service.notifyFunded(escrow)).resolves.toBeUndefined();
    // error logged once per channel after all retries are exhausted
    expect(Logger.prototype.error).toHaveBeenCalledTimes(2);
  });

  // ── response-code logging ─────────────────────────────────────────────────

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
