import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const baseEscrow = {
  id: 'esc-1',
  itemName: 'Widget',
  itemRef: 'ref-1',
  amount: 100,
  currency: 'USDC',
  buyerAddress: 'GBUYER',
  vendorAddress: 'GVENDOR',
  state: 'FUNDED' as const,
  trackingId: null,
  shippedAt: null,
  deliveredAt: null,
  deliveryRecordedAt: null,
  autoReleaseSubmittedAt: null,
  autoReleaseTxHash: null,
  disputeId: null,
  buyerContactEmail: null,
  buyerContactPhone: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('NotificationsService (#240)', () => {
  let prisma: PrismaService;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = new PrismaService();
    service = new NotificationsService(prisma);
  });

  it('creates a notification record with the message field set', async () => {
    await service.notifyFunded(baseEscrow);

    const notifications = await prisma.notification.findMany();
    expect(notifications.length).toBeGreaterThan(0);

    const record = notifications[0];
    expect(record.message).toBeDefined();
    expect(record.message).toBe(`FUNDED: ${baseEscrow.itemName}`);
  });

  it('sets all required fields (message, escrowId, type, channel, recipientAddress)', async () => {
    await service.notifyFunded(baseEscrow);

    const notifications = await prisma.notification.findMany();
    const record = notifications[0];

    expect(record.escrowId).toBe(baseEscrow.id);
    expect(record.type).toBe('FUNDED');
    expect(record.channel).toMatch(/^(EMAIL|SMS)$/);
    expect(record.recipientAddress).toBe(baseEscrow.vendorAddress);
    expect(record.message).toBeTruthy();
  });

  it('creates a notification record with message field for SMS channel', async () => {
    await service.notifyDisputed(baseEscrow);

    const notifications = await prisma.notification.findMany();
    const smsRecord = notifications.find((n) => n.channel === 'SMS');

    expect(smsRecord).toBeDefined();
    expect(smsRecord!.message).toBe(`DISPUTED: ${baseEscrow.itemName}`);
  });
});

describe('NotificationsService (#288) — email dispatch', () => {
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = new PrismaService();
  });

  it('dispatches email via SendGrid and records EMAIL notification', async () => {
    const mockSend = jest.fn().mockResolvedValue([{ statusCode: 202, headers: { 'x-message-id': 'msg-abc' } }]);
    const sendGrid = { send: mockSend };
    const service = new NotificationsService(prisma, sendGrid as any);

    await service.notifyFunded(baseEscrow);

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: baseEscrow.vendorAddress }),
    );

    const notifications = await prisma.notification.findMany();
    const emailRecord = notifications.find((n) => n.channel === 'EMAIL');
    expect(emailRecord).toBeDefined();
    expect(emailRecord!.type).toBe('FUNDED');
    expect(emailRecord!.recipientAddress).toBe(baseEscrow.vendorAddress);
  });

  it('dispatches SMS via Twilio and records SMS notification', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ sid: 'SM123' });
    const twilio = { messages: { create: mockCreate } };
    const service = new NotificationsService(prisma, undefined, twilio as any);

    await service.notifyShipped(baseEscrow);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: baseEscrow.buyerAddress }),
    );

    const notifications = await prisma.notification.findMany();
    const smsRecord = notifications.find((n) => n.channel === 'SMS');
    expect(smsRecord).toBeDefined();
    expect(smsRecord!.type).toBe('SHIPPED');
    expect(smsRecord!.providerMessageId).toBe('SM123');
  });

  it('is a no-op (noop provider) when SendGrid is not configured', async () => {
    // No sendGrid injected — service uses noopSendGrid internally
    const service = new NotificationsService(prisma);

    await expect(service.notifyFunded(baseEscrow)).resolves.toBeUndefined();

    const notifications = await prisma.notification.findMany();
    // Notification record is still written even when noop provider is used
    const emailRecord = notifications.find((n) => n.channel === 'EMAIL');
    expect(emailRecord).toBeDefined();
    expect(emailRecord!.attemptCount).toBe(1);
  });

  it('is a no-op (noop provider) when Twilio is not configured', async () => {
    const service = new NotificationsService(prisma);

    await expect(service.notifyDisputed(baseEscrow)).resolves.toBeUndefined();

    const notifications = await prisma.notification.findMany();
    const smsRecord = notifications.find((n) => n.channel === 'SMS');
    expect(smsRecord).toBeDefined();
    expect(smsRecord!.attemptCount).toBe(1);
  });

  it('creates a notification record on each dispatch', async () => {
    const service = new NotificationsService(prisma);

    await service.notifyFunded(baseEscrow);
    await service.notifyDisputed(baseEscrow);

    const notifications = await prisma.notification.findMany();
    // Each notify call sends email + SMS = 2 records per call → 4 total
    expect(notifications.length).toBeGreaterThanOrEqual(2);
  });

  it('retries on provider failure and records attemptCount > 1', async () => {
    const mockSend = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { code: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { code: 429 }))
      .mockResolvedValue([{ statusCode: 202, headers: {} }]);

    const sendGrid = { send: mockSend };
    const service = new NotificationsService(prisma, sendGrid as any);

    // Spy on sleep so retries don't actually delay the test
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await service.notifyFunded(baseEscrow);

    expect(mockSend).toHaveBeenCalledTimes(3);

    const notifications = await prisma.notification.findMany();
    const emailRecord = notifications.find((n) => n.channel === 'EMAIL');
    expect(emailRecord!.attemptCount).toBe(3);
  });

  it('records lastResponseCode from provider error on all-failed retries', async () => {
    const mockSend = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('server error'), { code: 500 }));

    const sendGrid = { send: mockSend };
    const service = new NotificationsService(prisma, sendGrid as any);

    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await service.notifyFunded(baseEscrow);

    const notifications = await prisma.notification.findMany();
    const emailRecord = notifications.find((n) => n.channel === 'EMAIL');
    expect(emailRecord!.attemptCount).toBe(3);
    expect(emailRecord!.lastResponseCode).toBe(500);
  });
});
