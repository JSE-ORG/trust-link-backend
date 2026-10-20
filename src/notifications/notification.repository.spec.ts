import { NotificationRepository } from './notification.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ensureVendors } from '../../test/prisma-helpers';

describe('NotificationRepository', () => {
  let repo: NotificationRepository;
  let prisma: PrismaService;
  let escrowId: string;

  beforeEach(async () => {
    prisma = new PrismaService();
    // State lives in a shared database, not a per-instance Map, so a suite
    // that does not clear it inherits whatever the previous file left behind
    // (#475).
    await prisma.reset();
    repo = new NotificationRepository(prisma);

    // Notification.escrowId is a foreign key, so the parent escrow has to
    // exist first.
    await ensureVendors(prisma, 'vendor-notif');
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Widget',
        itemRef: 'REF-NOTIF-1',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-notif',
        vendorAddress: 'vendor-notif',
      },
    });
    escrowId = escrow.id;
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool; leaving them
    // open across ~100 suites exhausts Postgres.
    await prisma?.$disconnect();
  });

  const base = {
    escrowId: '',
    type: 'FUNDED',
    recipientAddress: 'someone@example.test',
    message: 'FUNDED: Widget',
  };

  describe('create()', () => {
    it('persists an EMAIL delivery record as PENDING', async () => {
      const created = await repo.create({
        ...base,
        escrowId,
        channel: 'EMAIL',
        providerMessageId: 'sg-1',
        attemptCount: 1,
        lastResponseCode: 202,
      });

      expect(created.id).toBeDefined();
      expect(created.channel).toBe('EMAIL');
      expect(created.status).toBe('PENDING');
      expect(created.retryCount).toBe(0);
      expect(created.providerMessageId).toBe('sg-1');
      expect(created.attemptCount).toBe(1);
      expect(created.lastResponseCode).toBe(202);
    });

    it('stores an SMS delivery record with a null provider message id', async () => {
      const created = await repo.create({
        ...base,
        escrowId,
        channel: 'SMS',
        providerMessageId: null,
        attemptCount: 0,
        lastResponseCode: null,
      });

      expect(created.channel).toBe('SMS');
      expect(created.providerMessageId).toBeNull();
      expect(created.attemptCount).toBe(0);
    });
  });

  describe('markSent()', () => {
    it('marks the row SENT with sentAt and the retry count', async () => {
      const created = await repo.create({
        ...base,
        escrowId,
        channel: 'EMAIL',
      });

      const updated = await repo.markSent(created.id, 0);
      expect(updated.status).toBe('SENT');
      expect(updated.sentAt).toBeInstanceOf(Date);
      expect(updated.retryCount).toBe(0);

      // The write is durable, not just reflected on the returned object.
      const row = await prisma.notification.findUnique({
        where: { id: created.id },
      });
      expect(row?.status).toBe('SENT');
    });

    it('records how many retries the delivery took', async () => {
      const created = await repo.create({
        ...base,
        escrowId,
        channel: 'EMAIL',
      });

      const updated = await repo.markSent(created.id, 2);

      expect(updated.retryCount).toBe(2);
    });
  });

  describe('markAttemptFailed()', () => {
    it('records the attempt without ending the notification', async () => {
      const created = await repo.create({ ...base, escrowId, channel: 'SMS' });

      const updated = await repo.markAttemptFailed(created.id, 1, 'timeout');

      expect(updated.status).toBe('PENDING');
      expect(updated.retryCount).toBe(1);
      expect(updated.lastError).toBe('timeout');
      expect(updated.failedAt).toBeInstanceOf(Date);
    });
  });

  describe('markFailed()', () => {
    it('marks the row terminally FAILED', async () => {
      const created = await repo.create({
        ...base,
        escrowId,
        channel: 'EMAIL',
      });

      const updated = await repo.markFailed(created.id);

      expect(updated.status).toBe('FAILED');

      const row = await prisma.notification.findUnique({
        where: { id: created.id },
      });
      expect(row?.status).toBe('FAILED');
    });
  });
});
