/**
 * Unit tests for EscrowService.syncStateFromChain (Issue #40).
 *
 * All external dependencies (EscrowRepository, NotificationsService,
 * PrismaService) are replaced with Jest mocks so the tests run in-process
 * without a database or network.
 */

import { EscrowService, SorobanChainEvent } from './escrow.service';
import { EscrowRepository } from './escrow.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, EscrowRecord } from '../prisma/prisma.service';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEscrow(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  return {
    id: 'escrow-1',
    itemName: 'Widget',
    itemRef: 'REF-001',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'buyer-addr',
    vendorAddress: 'vendor-addr',
    state: 'FUNDED',
    trackingId: null,
    shippedAt: null,
    deliveredAt: null,
    deliveryRecordedAt: null,
    autoReleaseSubmittedAt: null,
    autoReleaseTxHash: null,
    disputeId: null,
    cancelledAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeEvent(
  eventType: string,
  extras: Partial<SorobanChainEvent> = {},
): SorobanChainEvent {
  return { eventType, escrowId: 'escrow-1', ...extras };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('EscrowService.syncStateFromChain', () => {
  let service: EscrowService;
  let repo: jest.Mocked<EscrowRepository>;
  let notifications: jest.Mocked<NotificationsService>;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    repo = {
      findById: jest.fn(),
      updateState: jest.fn(),
      markShipped: jest.fn(),
      markCompleted: jest.fn(),
      markAutoReleased: jest.fn(),
    } as unknown as jest.Mocked<EscrowRepository>;

    notifications = {
      notifyFunded: jest.fn().mockResolvedValue(undefined),
      notifyShipped: jest.fn().mockResolvedValue(undefined),
      notifyCompleted: jest.fn().mockResolvedValue(undefined),
      notifyDisputed: jest.fn().mockResolvedValue(undefined),
      notifyRefunded: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationsService>;

    prisma = {
      dispute: {
        create: jest.fn().mockResolvedValue({ id: 'dispute-1', status: 'OPEN' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'dispute-1', status: 'RESOLVED' }),
      },
    } as unknown as jest.Mocked<PrismaService>;

    service = new EscrowService(
      repo,
      notifications,
      undefined, // logisticsService
      undefined, // cacheService
      prisma,
    );
  });

  // ── EscrowFunded ─────────────────────────────────────────────────────────

  describe('EscrowFunded', () => {
    it('transitions CREATED → FUNDED and sends notification', async () => {
      const escrow = makeEscrow({ state: 'FUNDED' as any });
      repo.findById.mockResolvedValue(makeEscrow({ state: 'CREATED' as any }));
      repo.updateState.mockResolvedValue(escrow);

      const result = await service.syncStateFromChain(makeEvent('EscrowFunded'));

      expect(result).toEqual({ skipped: false });
      expect(repo.updateState).toHaveBeenCalledWith('escrow-1', 'FUNDED');
      // Notification is fire-and-forget; give microtask queue a tick
      await Promise.resolve();
      expect(notifications.notifyFunded).toHaveBeenCalledWith(escrow);
    });

    it('skips when escrow is already FUNDED (idempotent)', async () => {
      repo.findById.mockResolvedValue(makeEscrow({ state: 'FUNDED' }));

      const result = await service.syncStateFromChain(makeEvent('EscrowFunded'));

      expect(result).toEqual({ skipped: true, reason: 'already_funded_or_terminal' });
      expect(repo.updateState).not.toHaveBeenCalled();
    });

    it('skips when escrow is in a terminal state', async () => {
      repo.findById.mockResolvedValue(makeEscrow({ state: 'COMPLETED' }));

      const result = await service.syncStateFromChain(makeEvent('EscrowFunded'));

      expect(result).toEqual({ skipped: true, reason: 'already_funded_or_terminal' });
    });
  });

  // ── EscrowShipped ────────────────────────────────────────────────────────

  describe('EscrowShipped', () => {
    it('transitions FUNDED → SHIPPED with tracking ID and sends notification', async () => {
      const shipped = makeEscrow({ state: 'SHIPPED', trackingId: 'TRK-123' });
      repo.findById.mockResolvedValue(makeEscrow({ state: 'FUNDED' }));
      repo.markShipped.mockResolvedValue(shipped);

      const result = await service.syncStateFromChain(
        makeEvent('EscrowShipped', { trackingId: 'TRK-123' }),
      );

      expect(result).toEqual({ skipped: false });
      expect(repo.markShipped).toHaveBeenCalledWith('escrow-1', 'TRK-123');
      await Promise.resolve();
      expect(notifications.notifyShipped).toHaveBeenCalledWith(shipped);
    });

    it('skips when escrow is already SHIPPED (idempotent)', async () => {
      repo.findById.mockResolvedValue(makeEscrow({ state: 'SHIPPED', trackingId: 'TRK-123' }));

      const result = await service.syncStateFromChain(
        makeEvent('EscrowShipped', { trackingId: 'TRK-123' }),
      );

      expect(result).toEqual({ skipped: true, reason: 'already_shipped_or_terminal' });
      expect(repo.markShipped).not.toHaveBeenCalled();
    });
  });

  // ── EscrowCompleted ──────────────────────────────────────────────────────

  describe('EscrowCompleted', () => {
    it('transitions to COMPLETED and sends notification', async () => {
      const completed = makeEscrow({ state: 'COMPLETED' });
      repo.findById.mockResolvedValue(makeEscrow({ state: 'SHIPPED' }));
      repo.markCompleted.mockResolvedValue(completed);

      const result = await service.syncStateFromChain(makeEvent('EscrowCompleted'));

      expect(result).toEqual({ skipped: false });
      expect(repo.markCompleted).toHaveBeenCalledWith('escrow-1');
      await Promise.resolve();
      expect(notifications.notifyCompleted).toHaveBeenCalledWith(completed);
    });

    it('skips when escrow is already COMPLETED (idempotent)', async () => {
      repo.findById.mockResolvedValue(makeEscrow({ state: 'COMPLETED' }));

      const result = await service.syncStateFromChain(makeEvent('EscrowCompleted'));

      expect(result).toEqual({ skipped: true, reason: 'already_completed_or_terminal' });
      expect(repo.markCompleted).not.toHaveBeenCalled();
    });
  });

  // ── DisputeRaised ────────────────────────────────────────────────────────

  describe('DisputeRaised', () => {
    it('creates dispute, transitions to DISPUTED, and sends notification', async () => {
      const disputed = makeEscrow({ state: 'DISPUTED' });
      repo.findById.mockResolvedValue(makeEscrow({ state: 'FUNDED' }));
      repo.updateState.mockResolvedValue(disputed);

      const result = await service.syncStateFromChain(
        makeEvent('DisputeRaised', { reason: 'Item not delivered' }),
      );

      expect(result).toEqual({ skipped: false });
      expect(prisma.dispute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ escrowId: 'escrow-1', reason: 'Item not delivered' }),
        }),
      );
      expect(repo.updateState).toHaveBeenCalledWith('escrow-1', 'DISPUTED');
      await Promise.resolve();
      expect(notifications.notifyDisputed).toHaveBeenCalledWith(disputed);
    });

    it('skips when escrow is already DISPUTED (idempotent)', async () => {
      repo.findById.mockResolvedValue(makeEscrow({ state: 'DISPUTED' }));

      const result = await service.syncStateFromChain(makeEvent('DisputeRaised'));

      expect(result).toEqual({ skipped: true, reason: 'already_disputed' });
      expect(prisma.dispute.create).not.toHaveBeenCalled();
    });
  });

  // ── DisputeResolved ──────────────────────────────────────────────────────

  describe('DisputeResolved', () => {
    it('resolves dispute, completes escrow, and sends notification', async () => {
      const completed = makeEscrow({ state: 'COMPLETED' });
      repo.findById.mockResolvedValue(makeEscrow({ state: 'DISPUTED' }));
      repo.markCompleted.mockResolvedValue(completed);
      prisma.dispute.findFirst = jest.fn().mockResolvedValue({ id: 'dispute-1', status: 'OPEN' });

      const result = await service.syncStateFromChain(makeEvent('DisputeResolved'));

      expect(result).toEqual({ skipped: false });
      expect(prisma.dispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dispute-1' },
          data: expect.objectContaining({ status: 'RESOLVED' }),
        }),
      );
      expect(repo.markCompleted).toHaveBeenCalledWith('escrow-1');
      await Promise.resolve();
      expect(notifications.notifyCompleted).toHaveBeenCalledWith(completed);
    });

    it('skips when dispute is already RESOLVED (idempotent)', async () => {
      repo.findById.mockResolvedValue(makeEscrow({ state: 'COMPLETED' }));
      prisma.dispute.findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'dispute-1', status: 'RESOLVED' });

      const result = await service.syncStateFromChain(makeEvent('DisputeResolved'));

      expect(result).toEqual({ skipped: true, reason: 'dispute_already_resolved' });
      expect(repo.markCompleted).not.toHaveBeenCalled();
    });
  });

  // ── AutoReleased ─────────────────────────────────────────────────────────

  describe('AutoReleased', () => {
    it('marks escrow RELEASED with txHash and sends notification', async () => {
      const released = makeEscrow({ state: 'RELEASED', autoReleaseTxHash: 'TX-ABC' });
      repo.findById.mockResolvedValue(makeEscrow({ state: 'SHIPPED' }));
      repo.markAutoReleased = jest.fn().mockResolvedValue(released);

      const result = await service.syncStateFromChain(
        makeEvent('AutoReleased', { txHash: 'TX-ABC' }),
      );

      expect(result).toEqual({ skipped: false });
      expect(repo.markAutoReleased).toHaveBeenCalledWith('escrow-1', 'TX-ABC');
      await Promise.resolve();
      expect(notifications.notifyCompleted).toHaveBeenCalledWith(released);
    });

    it('skips when escrow is already RELEASED (idempotent)', async () => {
      repo.findById.mockResolvedValue(makeEscrow({ state: 'RELEASED' }));

      const result = await service.syncStateFromChain(
        makeEvent('AutoReleased', { txHash: 'TX-ABC' }),
      );

      expect(result).toEqual({ skipped: true, reason: 'already_released' });
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns skipped when escrow is not found', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await service.syncStateFromChain(makeEvent('EscrowFunded'));

      expect(result).toEqual({ skipped: true, reason: 'escrow_not_found' });
    });

    it('returns skipped for an unknown event type', async () => {
      repo.findById.mockResolvedValue(makeEscrow());

      const result = await service.syncStateFromChain(makeEvent('UnknownEvent'));

      expect(result).toEqual({ skipped: true, reason: 'unknown_event_type' });
    });
  });
});
