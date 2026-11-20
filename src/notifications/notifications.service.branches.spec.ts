/**
 * Tests for NotificationsService branches (issue #1127).
 *
 * Covers: notifyDisputedAdmin (no ADMIN_NOTIFICATION_EMAIL → returns early),
 * dispatchToBuyer (no email/phone → recordUndeliverable),
 * traced (no tracing service → calls fn directly).
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
