/**
 * Issue #310 — composite index verification for the auto-release worker query.
 *
 * The auto-release worker calls findAutoReleaseEligible() which filters on
 * (state = 'DELIVERED', deliveredAt <= threshold).  Two composite indexes were
 * added to the Escrow model so PostgreSQL can satisfy this query with an index
 * range scan instead of a sequential scan:
 *
 *   @@index([state, deliveredAt])   – used by findAutoReleaseEligible
 *   @@index([state, createdAt])     – used by createdAt-ordered state queries
 *
 * EXPLAIN ANALYZE (run against a populated staging DB) confirmed index usage:
 *
 *   Index Scan using "Escrow_state_deliveredAt_idx" on "Escrow"
 *     Index Cond: ((state = 'DELIVERED') AND (deliveredAt <= <threshold>))
 *
 * These unit tests verify the filtering semantics that drive index selectivity,
 * ensuring the WHERE clause matches what the index covers.
 *
 * Fixtures go through markDelivered() rather than directly setting
 * state=SHIPPED + deliveredAt, since markDelivered is the sole writer of
 * deliveredAt and always transitions state to DELIVERED in the same update —
 * SHIPPED+deliveredAt is an impossible combination in production.
 */
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { EscrowState, PrismaService } from '../../src/prisma/prisma.service';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const hours = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

async function createDeliveredEscrow(
  prisma: PrismaService,
  repository: EscrowRepository,
  overrides: {
    itemRef: string;
    deliveredAt: Date;
    state?: EscrowState;
    autoReleaseTxHash?: string | null;
    autoReleaseSubmittedAt?: Date | null;
    disputeId?: string | null;
  },
) {
  const {
    itemRef,
    deliveredAt,
    state,
    autoReleaseTxHash,
    autoReleaseSubmittedAt,
    disputeId,
  } = overrides;

  const base = await prisma.escrow.create({
    data: {
      itemName: `Item-${itemRef}`,
      itemRef,
      amount: 100,
      currency: 'USDC',
      buyerAddress: 'buyer-1',
      vendorAddress: 'vendor-1',
      state: state ?? 'SHIPPED',
      shippedAt: new Date(deliveredAt.getTime() - 24 * 60 * 60 * 1000),
    },
  });

  let escrow;
  if (state === undefined) {
    escrow = await repository.markDelivered(base.id, deliveredAt);
  } else {
    escrow = await prisma.escrow.update({
      where: { id: base.id },
      data: {
        state,
        deliveredAt,
        deliveryRecordedAt: deliveredAt,
        autoReleaseTxHash: autoReleaseTxHash ?? undefined,
        autoReleaseSubmittedAt: autoReleaseSubmittedAt ?? undefined,
        disputeId: disputeId ?? undefined,
      },
    });
  }

  if (autoReleaseTxHash !== undefined && autoReleaseTxHash !== null) {
    escrow = await prisma.escrow.update({
      where: { id: escrow.id },
      data: { autoReleaseTxHash },
    });
  }
  if (autoReleaseSubmittedAt !== undefined && autoReleaseSubmittedAt !== null) {
    escrow = await prisma.escrow.update({
      where: { id: escrow.id },
      data: { autoReleaseSubmittedAt },
    });
  }
  if (disputeId !== undefined && disputeId !== null) {
    escrow = await prisma.escrow.update({
      where: { id: escrow.id },
      data: { disputeId },
    });
  }

  return escrow;
}

describe('EscrowRepository – auto-release index query (issue #310)', () => {
  let repository: EscrowRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    repository = new EscrowRepository(prisma);
    await prisma.reset();
  });

  // ── (state, deliveredAt) index path ──────────────────────────────────────

  it('returns DELIVERED escrow delivered more than 48 h ago', async () => {
    await createDeliveredEscrow(prisma, repository, {
      itemRef: 'widget-001',
      deliveredAt: hours(50),
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(1);
    expect(results[0].state).toBe('DELIVERED');
  });

  it('excludes DELIVERED escrow delivered less than 48 h ago (deliveredAt boundary)', async () => {
    await createDeliveredEscrow(prisma, repository, {
      itemRef: 'widget-002',
      deliveredAt: hours(47),
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes non-DELIVERED escrows regardless of deliveredAt (state predicate)', async () => {
    for (const state of [
      'FUNDED',
      'SHIPPED',
      'COMPLETED',
      'DISPUTED',
    ] as const) {
      await createDeliveredEscrow(prisma, repository, {
        itemRef: `item-${state.toLowerCase()}`,
        deliveredAt: hours(72),
        state,
      });
    }

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes eligible escrow that already has autoReleaseTxHash', async () => {
    await createDeliveredEscrow(prisma, repository, {
      itemRef: 'widget-003',
      deliveredAt: hours(50),
      autoReleaseTxHash: 'existing-tx-hash',
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes eligible escrow that has autoReleaseSubmittedAt set (in-flight claim)', async () => {
    await createDeliveredEscrow(prisma, repository, {
      itemRef: 'widget-004',
      deliveredAt: hours(50),
      autoReleaseSubmittedAt: hours(1),
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes eligible escrow that has disputeId set', async () => {
    await createDeliveredEscrow(prisma, repository, {
      itemRef: 'widget-005',
      deliveredAt: hours(50),
      disputeId: 'dispute-001',
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('returns only eligible rows when mixed data is present', async () => {
    const eligible = await createDeliveredEscrow(prisma, repository, {
      itemRef: 'eligible-001',
      deliveredAt: hours(60),
    });

    // Recent delivery — not yet past the 48-hour threshold
    await createDeliveredEscrow(prisma, repository, {
      itemRef: 'recent-001',
      deliveredAt: hours(24),
    });

    // Already released — txHash excludes it (create as DELIVERED first, then set tx)
    await createDeliveredEscrow(prisma, repository, {
      itemRef: 'released-001',
      deliveredAt: hours(55),
      autoReleaseTxHash: 'done-tx',
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(eligible.id);
  });

  // ── (state, createdAt) index path ─────────────────────────────────────────

  it('confirms createdAt is recorded on escrow creation (feeds state+createdAt index)', async () => {
    const before = new Date();
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Indexed',
        itemRef: 'indexed-001',
        amount: 200,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'CREATED',
      },
    });
    const after = new Date();

    expect(escrow.createdAt).toBeInstanceOf(Date);
    expect(escrow.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(escrow.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
