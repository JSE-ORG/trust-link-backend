import { NotificationsService } from './notifications.service';
import {
  PrismaService,
  toEscrowRecord,
  type EscrowRecord,
} from '../prisma/prisma.service';
import { ensureVendors } from '../../test/prisma-helpers';

// Populated per test from a real row. Notification.escrowId is a foreign key
// onto Escrow.id, and Escrow.vendorAddress onto VendorProfile.address, so a
// hand-built literal is no longer enough to write a notification against (#475).
let baseEscrow: EscrowRecord;

describe('NotificationsService (#240)', () => {
  let prisma: PrismaService;
  let service: NotificationsService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    await ensureVendors(prisma, 'GVENDOR');
    baseEscrow = toEscrowRecord(
      await prisma.escrow.create({
        data: {
          itemName: 'Widget',
          itemRef: 'ref-1',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'GBUYER',
          vendorAddress: 'GVENDOR',
          state: 'FUNDED',
        },
      }),
    );
    service = new NotificationsService(prisma);
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool. Constructed in
    // beforeEach across ~100 suites, undisconnected clients exhaust Postgres
    // (`sorry, too many clients already`) partway through a full run.
    await prisma?.$disconnect();
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

  beforeEach(async () => {
    prisma = new PrismaService();
    // State now lives in a shared database rather than a per-instance Map, so
    // rows leak between tests unless each one starts clean (#475).
    await prisma.reset();
    await ensureVendors(prisma, 'GVENDOR');
    baseEscrow = toEscrowRecord(
      await prisma.escrow.create({
        data: {
          itemName: 'Widget',
          itemRef: 'ref-1',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'GBUYER',
          vendorAddress: 'GVENDOR',
          state: 'FUNDED',
        },
      }),
    );
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  it('dispatches email via SendGrid and records EMAIL notification', async () => {
    const mockSend = jest
      .fn()
      .mockResolvedValue([
        { statusCode: 202, headers: { 'x-message-id': 'msg-abc' } },
      ]);
    const sendGrid = { send: mockSend };
    const service = new NotificationsService(prisma, sendGrid);

    await service.notifyFunded(baseEscrow);

    expect(mockSend).toHaveBeenCalledTimes(1);
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
    const service = new NotificationsService(prisma, undefined, twilio);

    await service.notifyShipped(baseEscrow);

    expect(mockCreate).toHaveBeenCalledTimes(1);
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
      .mockRejectedValueOnce(
        Object.assign(new Error('rate limit'), { code: 429 }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('rate limit'), { code: 429 }),
      )
      .mockResolvedValue([{ statusCode: 202, headers: {} }]);

    const sendGrid = { send: mockSend };
    const service = new NotificationsService(prisma, sendGrid);

    // Spy on sleep so retries don't actually delay the test
    jest
      .spyOn(service, 'sleep' as keyof NotificationsService)
      .mockResolvedValue(undefined);

    await service.notifyFunded(baseEscrow);

    expect(mockSend).toHaveBeenCalledTimes(3);

    const notifications = await prisma.notification.findMany();
    const emailRecord = notifications.find((n) => n.channel === 'EMAIL');
    expect(emailRecord!.attemptCount).toBe(3);
  });

  it('records lastResponseCode from provider error on all-failed retries', async () => {
    const mockSend = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('server error'), { code: 500 }),
      );

    const sendGrid = { send: mockSend };
    const service = new NotificationsService(prisma, sendGrid);

    jest
      .spyOn(service, 'sleep' as keyof NotificationsService)
      .mockResolvedValue(undefined);

    await service.notifyFunded(baseEscrow);

    const notifications = await prisma.notification.findMany();
    const emailRecord = notifications.find((n) => n.channel === 'EMAIL');
    expect(emailRecord!.attemptCount).toBe(3);
    expect(emailRecord!.lastResponseCode).toBe(500);
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
  ): EscrowRecord =>
    ({
      id: 'escrow-726',
      itemName: 'Widget',
      itemRef: 'ref-726',
      amount: 50 as unknown as EscrowRecord['amount'],
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
    }) as EscrowRecord;

  function makeStubPrisma() {
    const created: Array<Record<string, unknown>> = [];
    return {
      stubPrisma: {
        notification: {
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return Promise.resolve(data);
          }),
          findMany: jest.fn().mockImplementation(() => Promise.resolve(created)),
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
      .mockImplementationOnce(() => { throw new Error('bad phone'); }); // phone fails

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
      .mockImplementationOnce(() => { throw new Error('bad email'); }) // email fails
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
    amount: 50 as unknown as EscrowRecord['amount'],
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
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve(data);
        }),
        findFirst: jest.fn().mockImplementation(
          ({ where }: { where: { channel?: string } }) =>
            Promise.resolve(created.find((r) => r.channel === where.channel) ?? null),
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
