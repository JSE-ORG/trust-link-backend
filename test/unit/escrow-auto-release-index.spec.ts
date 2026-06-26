/**
 * Issue #310 — composite index verification for the auto-release worker query.
 *
 * The auto-release worker calls findAutoReleaseEligible() which filters on
 * (state = 'SHIPPED', deliveredAt <= threshold).  Two composite indexes were
 * added to the Escrow model so PostgreSQL can satisfy this query with an index
 * range scan instead of a sequential scan:
 *
 *   @@index([state, deliveredAt])   – used by findAutoReleaseEligible
 *   @@index([state, createdAt])     – used by createdAt-ordered state queries
 *
 * EXPLAIN ANALYZE (run against a populated staging DB) confirmed index usage:
 *
 *   Index Scan using "Escrow_state_deliveredAt_idx" on "Escrow"
 *     Index Cond: ((state = 'SHIPPED') AND (deliveredAt <= <threshold>))
 *
 * These unit tests verify the filtering semantics that drive index selectivity,
 * ensuring the WHERE clause matches what the index covers.
 */
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { PrismaService } from '../../src/prisma/prisma.service';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const hours = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

describe('EscrowRepository – auto-release index query (issue #310)', () => {
  let repository: EscrowRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    repository = new EscrowRepository(prisma);
    await prisma.reset();
  });

  // ── (state, deliveredAt) index path ──────────────────────────────────────

  it('returns SHIPPED escrow delivered more than 48 h ago', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Widget',
        itemRef: 'widget-001',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        deliveredAt: hours(50),
        deliveryRecordedAt: hours(50),
      },
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(1);
    expect(results[0].state).toBe('SHIPPED');
  });

  it('excludes SHIPPED escrow delivered less than 48 h ago (deliveredAt boundary)', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Widget',
        itemRef: 'widget-002',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        deliveredAt: hours(47),
        deliveryRecordedAt: hours(47),
      },
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes non-SHIPPED escrows regardless of deliveredAt (state predicate)', async () => {
    for (const state of ['FUNDED', 'DELIVERED', 'COMPLETED', 'DISPUTED'] as const) {
      await prisma.escrow.create({
        data: {
          itemName: `Item-${state}`,
          itemRef: `item-${state.toLowerCase()}`,
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          state,
          deliveredAt: hours(72),
        },
      });
    }

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes eligible escrow that already has autoReleaseTxHash', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Widget',
        itemRef: 'widget-003',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        deliveredAt: hours(50),
        deliveryRecordedAt: hours(50),
        autoReleaseTxHash: 'existing-tx-hash',
      },
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes eligible escrow that has autoReleaseSubmittedAt set (in-flight claim)', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Widget',
        itemRef: 'widget-004',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        deliveredAt: hours(50),
        deliveryRecordedAt: hours(50),
        autoReleaseSubmittedAt: hours(1),
      },
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes eligible escrow that has disputeId set', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Widget',
        itemRef: 'widget-005',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        deliveredAt: hours(50),
        deliveryRecordedAt: hours(50),
        disputeId: 'dispute-001',
      },
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('returns only eligible rows when mixed data is present', async () => {
    const eligible = await prisma.escrow.create({
      data: {
        itemName: 'Eligible',
        itemRef: 'eligible-001',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        deliveredAt: hours(60),
        deliveryRecordedAt: hours(60),
      },
    });

    // Recent delivery — not yet past the 48-hour threshold
    await prisma.escrow.create({
      data: {
        itemName: 'TooRecent',
        itemRef: 'recent-001',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        state: 'SHIPPED',
        deliveredAt: hours(24),
        deliveryRecordedAt: hours(24),
      },
    });

    // Already released — txHash excludes it
    await prisma.escrow.create({
      data: {
        itemName: 'Released',
        itemRef: 'released-001',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-3',
        vendorAddress: 'vendor-3',
        state: 'SHIPPED',
        deliveredAt: hours(55),
        autoReleaseTxHash: 'done-tx',
      },
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
