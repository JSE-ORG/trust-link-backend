import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService (#240)', () => {
  let prisma: PrismaService;
  let service: NotificationsService;

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
