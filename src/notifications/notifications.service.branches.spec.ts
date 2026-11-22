/**
 * Tests for NotificationsService branches (issue #1127).
 *
 * Covers: notifyDisputedAdmin (no ADMIN_NOTIFICATION_EMAIL → returns early),
 * dispatchToBuyer (no email/phone → recordUndeliverable),
 * traced (no tracing service → calls fn directly).
 *
 * Issue #1226 adds: traced with a synchronous fn, dispatchToVendor with null
 * preferences (default channels), createNotification without a repository
 * `create` (legacy delegate, then no delegate at all), and the `statusCode` /
 * `status` shapes read by extractSuccessCode and extractResponseCode.
 */

import { NotificationsService } from './notifications.service';
import { EscrowRecord } from '../prisma/prisma.service';
import { NotificationRepository } from './notification.repository';

type Priv = Record<string, (...args: any[]) => any>;

function makeEscrow(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    id: 'e-1',
    contractEscrowId: null,
    itemName: 'Item',
    itemRef: 'REF-1',
    amount: 50,
    currency: 'USDC',
    buyerAddress: 'BUYER',
    vendorAddress: 'VENDOR',
    state: 'FUNDED',
    trackingId: null,
    carrier: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeNotificationRepo() {
  return {
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'n-1' }),
    },
    create: jest.fn().mockResolvedValue({ id: 'n-1' }),
  } as unknown as NotificationRepository;
}

describe('NotificationsService.notifyDisputedAdmin', () => {
  it('returns early without calling providers when ADMIN_NOTIFICATION_EMAIL is not set', async () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const svc = new NotificationsService(
      makeNotificationRepo(),
      undefined,
      undefined,
      config as never,
    );

    // Should not throw and should not call any send method
    await expect(
      svc.notifyDisputedAdmin(makeEscrow()),
    ).resolves.toBeUndefined();
  });
});

describe('NotificationsService.dispatchToBuyer (no contact info)', () => {
  it('records undeliverable notification when no email or phone is set on escrow', async () => {
    const notificationCreate = jest.fn().mockResolvedValue({ id: 'n-1' });
    const repo = {
      create: notificationCreate,
    } as unknown as NotificationRepository;
    const svc = new NotificationsService(repo, undefined, undefined, undefined);

    const escrow = makeEscrow() as EscrowRecord & {
      buyerContactEmail?: null;
      buyerContactPhone?: null;
    };
    escrow.buyerContactEmail = null;
    escrow.buyerContactPhone = null;

    await (svc as unknown as Priv)['dispatchToBuyer']('SHIPPED', escrow);

    // recordUndeliverable is called twice (EMAIL + SMS)
    expect(notificationCreate).toHaveBeenCalledTimes(2);
  });
});

describe('NotificationsService.traced', () => {
  it('calls fn directly when no tracing service is injected', async () => {
    const svc = new NotificationsService(makeNotificationRepo());
    const fn = jest.fn().mockResolvedValue('result');

    const result = await (svc as unknown as Priv)['traced']('op', {}, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('result');
  });
});

// ── Issue #1226 ──────────────────────────────────────────────────────────────

describe('NotificationsService.traced (no tracing service, sync fn)', () => {
  it('wraps a synchronous return value in a promise', async () => {
    const svc = new NotificationsService(makeNotificationRepo());
    const fn = jest.fn().mockReturnValue(42);

    const pending = (svc as unknown as Priv)['traced']('op', {}, fn);

    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationsService.dispatchToVendor (null preferences)', () => {
  function makeVendorService(prefs: unknown) {
    const repo = {
      create: jest.fn().mockResolvedValue({ id: 'n-1' }),
    } as unknown as NotificationRepository;
    const sendGrid = { send: jest.fn().mockResolvedValue(undefined) };
    const twilio = {
      messages: { create: jest.fn().mockResolvedValue({ sid: 'SM1' }) },
    };
    const vendorProfiles = {
      findByAddress: jest.fn().mockResolvedValue({
        email: 'vendor@example.com',
        phone: '+2348000000000',
      }),
      findNotificationPreferences:
        prefs instanceof Error
          ? jest.fn().mockRejectedValue(prefs)
          : jest.fn().mockResolvedValue(prefs),
    };
    // A configured SendGrid client needs a sender and a template id, or the
    // email is recorded as undeliverable without a send.
    const config = {
      get: jest.fn((key: string) =>
        key === 'SENDGRID_FROM_EMAIL'
          ? 'noreply@trustlink.test'
          : key.startsWith('SENDGRID_TEMPLATE_')
            ? `d-${key.toLowerCase()}`
            : undefined,
      ),
    };
    const svc = new NotificationsService(
      repo,
      sendGrid,
      twilio,
      config as never,
      vendorProfiles as never,
    );
    return { svc, repo, sendGrid, twilio };
  }

  it('falls back to the default channels (EMAIL only) when no preferences are stored', async () => {
    const { svc, repo, sendGrid, twilio } = makeVendorService(null);

    await (svc as unknown as Priv)['dispatchToVendor']('FUNDED', makeEscrow());

    expect(sendGrid.send).toHaveBeenCalledTimes(1);
    expect(sendGrid.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'vendor@example.com' }),
    );
    expect(twilio.messages.create).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'EMAIL', type: 'FUNDED' }),
    );
  });

  it('uses the default channels when loading preferences fails', async () => {
    const { svc, sendGrid, twilio } = makeVendorService(
      new Error('db unavailable'),
    );

    await (svc as unknown as Priv)['dispatchToVendor'](
      'DISPUTED',
      makeEscrow(),
    );

    expect(sendGrid.send).toHaveBeenCalledTimes(1);
    expect(twilio.messages.create).not.toHaveBeenCalled();
  });

  it('still sends DELIVERED when preferences are null (notifyOnDelivery unset)', async () => {
    const { svc, sendGrid } = makeVendorService(null);

    await (svc as unknown as Priv)['dispatchToVendor'](
      'DELIVERED',
      makeEscrow(),
    );

    expect(sendGrid.send).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationsService.createNotification (fallbacks)', () => {
  const input = {
    escrowId: 'e-1',
    type: 'FUNDED',
    channel: 'EMAIL',
    recipientAddress: 'vendor@example.com',
    message: 'FUNDED: Item',
    providerMessageId: null,
    attemptCount: 0,
    lastResponseCode: null,
  };

  it('writes through a legacy `notification` delegate when the writer has no create()', async () => {
    const legacyCreate = jest.fn().mockResolvedValue({ id: 'n-legacy' });
    const svc = new NotificationsService({
      notification: { create: legacyCreate },
    });

    const result = await (svc as unknown as Priv)['createNotification'](input);

    expect(legacyCreate).toHaveBeenCalledWith({ data: input });
    expect(result).toEqual({ id: 'n-legacy' });
  });

  it('resolves to undefined when the writer has neither create() nor a notification delegate', async () => {
    const svc = new NotificationsService({});

    await expect(
      (svc as unknown as Priv)['createNotification'](input),
    ).resolves.toBeUndefined();
  });

  it('ignores a non-function create property and uses the legacy delegate', async () => {
    const legacyCreate = jest.fn().mockResolvedValue({ id: 'n-legacy' });
    const svc = new NotificationsService({
      create: 'not-a-function',
      notification: { create: legacyCreate },
    } as never);

    await (svc as unknown as Priv)['createNotification'](input);

    expect(legacyCreate).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationsService.extractSuccessCode', () => {
  const svc = new NotificationsService(makeNotificationRepo());
  const extract = (response: unknown) =>
    (svc as unknown as Priv)['extractSuccessCode'](response);

  it('reads statusCode from the first element of a SendGrid response tuple', () => {
    expect(extract([{ statusCode: 202, headers: {} }])).toBe(202);
  });

  it('returns null when statusCode is not a number', () => {
    expect(extract([{ statusCode: '202' }])).toBeNull();
    expect(extract([{ status: 202 }])).toBeNull();
  });

  it('returns null for non-array, empty or null-headed responses', () => {
    expect(extract({ statusCode: 202 })).toBeNull();
    expect(extract([])).toBeNull();
    expect(extract([null])).toBeNull();
    expect(extract(undefined)).toBeNull();
  });
});

describe('NotificationsService.extractResponseCode', () => {
  const svc = new NotificationsService(makeNotificationRepo());
  const extract = (error: unknown) =>
    (svc as unknown as Priv)['extractResponseCode'](error);

  it('reads a numeric code first (Twilio errors)', () => {
    expect(extract({ code: 401, status: 500 })).toBe(401);
  });

  it('reads a top-level numeric status', () => {
    expect(extract({ status: 429 })).toBe(429);
  });

  it('reads response.statusCode (SendGrid ResponseError)', () => {
    expect(extract({ response: { statusCode: 400 } })).toBe(400);
  });

  it('reads response.status when response.statusCode is absent', () => {
    expect(extract({ response: { status: 503 } })).toBe(503);
  });

  it('prefers response.statusCode over response.status', () => {
    expect(extract({ response: { statusCode: 413, status: 500 } })).toBe(413);
  });

  it('returns null when no numeric code is present', () => {
    expect(extract({ code: 'ECONNRESET' })).toBeNull();
    expect(extract({ response: { status: '500' } })).toBeNull();
    expect(extract({ response: null })).toBeNull();
    expect(extract(new Error('boom'))).toBeNull();
    expect(extract(null)).toBeNull();
    expect(extract('error')).toBeNull();
  });
});
