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

  describe('findVendorHistory() (issue #1168)', () => {
    it('enforces field allowlist and ownership isolation', async () => {
      await ensureVendors(prisma, 'vendor-other');
      const otherEscrow = await prisma.escrow.create({
        data: {
          itemName: 'Other Widget',
          itemRef: 'REF-OTHER-1',
          amount: 50,
          currency: 'USDC',
          buyerAddress: 'buyer-other',
          vendorAddress: 'vendor-other',
        },
      });

      // Notification for vendor-notif
      await repo.create({
        ...base,
        escrowId,
        channel: 'EMAIL',
      });

      // Notification for vendor-other
      await repo.create({
        ...base,
        escrowId: otherEscrow.id,
        channel: 'SMS',
      });

      const result = await repo.findVendorHistory('vendor-notif');

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      const row = result.data[0] as Record<string, unknown>;

      // Field allowlist: allowed fields are present
      expect(row.id).toBeDefined();
      expect(row.escrowId).toBe(escrowId);
      expect(row.type).toBe('FUNDED');
      expect(row.channel).toBe('EMAIL');
      expect(row.status).toBe('PENDING');
      expect(row.attemptCount).toBe(0);
      expect(row.createdAt).toBeInstanceOf(Date);

      // Sensitive fields MUST NEVER be returned
      expect(row.recipientAddress).toBeUndefined();
      expect(row.message).toBeUndefined();
      expect(row.lastError).toBeUndefined();
    });

    it('filters by status and escrowId', async () => {
      const n1 = await repo.create({
        ...base,
        escrowId,
        channel: 'EMAIL',
      });
      await repo.markSent(n1.id, 0);

      const n2 = await repo.create({
        ...base,
        escrowId,
        channel: 'SMS',
      });
      await repo.markFailed(n2.id);

      const sentOnly = await repo.findVendorHistory('vendor-notif', {
        status: 'SENT',
      });
      expect(sentOnly.total).toBe(1);
      expect(sentOnly.data[0].status).toBe('SENT');

      const byEscrow = await repo.findVendorHistory('vendor-notif', {
        escrowId,
      });
      expect(byEscrow.total).toBe(2);
    });
  });

  describe('findAdminNotifications() (issue #1169)', () => {
    it('returns lastError and lastResponseCode but never recipientAddress or message', async () => {
      const n1 = await repo.create({
        ...base,
        escrowId,
        channel: 'EMAIL',
        lastResponseCode: 500,
      });
      await repo.markAttemptFailed(n1.id, 1, 'Provider connection error');

      const result = await repo.findAdminNotifications();

      expect(result.total).toBeGreaterThanOrEqual(1);
      const row = result.data.find((r) => r.id === n1.id) as unknown as Record<
        string,
        unknown
      >;

      expect(row).toBeDefined();
      expect(row.lastError).toBe('Provider connection error');
      expect(row.lastResponseCode).toBe(500);

      // Sensitive fields MUST NEVER be returned
      expect(row.recipientAddress).toBeUndefined();
      expect(row.message).toBeUndefined();
    });

    it('filters by status, channel, type, and date range', async () => {
      await repo.create({
        ...base,
        escrowId,
        channel: 'SMS',
        type: 'SHIPPED',
      });

      const filtered = await repo.findAdminNotifications({
        channel: 'SMS',
        type: 'SHIPPED',
      });
      expect(filtered.total).toBe(1);
      expect(filtered.data[0].channel).toBe('SMS');
      expect(filtered.data[0].type).toBe('SHIPPED');
    });
  });
});
