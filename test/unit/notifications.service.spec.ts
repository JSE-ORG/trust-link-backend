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
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('catches provider failures and logs without throwing', async () => {
    sendGrid.send.mockRejectedValue(new Error('sendgrid down'));
    twilio.messages.create.mockRejectedValue(new Error('twilio down'));

    await expect(service.notifyFunded(escrow)).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledTimes(2);
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
});
