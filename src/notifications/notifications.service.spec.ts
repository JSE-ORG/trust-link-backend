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
