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
 * Issue #395 — the predicate was 'SHIPPED' here and in the repository, which
 * no row can satisfy. Fixtures below go through `markDelivered` rather than
 * writing `deliveredAt` by hand, so a state the application cannot produce can
 * no longer be constructed to make these assertions pass.
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
    await prisma.vendorProfile.createMany({
      data: [
        { address: 'vendor-1', businessName: 'Vendor 1' },
        { address: 'vendor-2', businessName: 'Vendor 2' },
        { address: 'vendor-3', businessName: 'Vendor 3' },
      ],
      skipDuplicates: true,
    });
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool. Constructed in
    // beforeEach across ~100 suites, undisconnected clients exhaust Postgres
    // (`sorry, too many clients already`) partway through a full run.
    await prisma?.$disconnect();
  });

  /**
   * Creates a SHIPPED escrow and delivers it through `markDelivered`, the only
   * writer of `deliveredAt` in the application. Everything the eligibility
   * query reads is therefore set the way production sets it.
   */
  const deliver = async (
    itemRef: string,
    deliveredAt: Date,
    overrides: {
      vendorAddress?: string;
      buyerAddress?: string;
      autoReleaseTxHash?: string;
      autoReleaseSubmittedAt?: Date;
      disputeId?: string;
    } = {},
  ) => {
    const {
      vendorAddress = 'vendor-1',
      buyerAddress = 'buyer-1',
      ...after
    } = overrides;
    const escrow = await prisma.escrow.create({
      data: {
        itemName: itemRef,
        itemRef,
        amount: 100,
        currency: 'USDC',
        buyerAddress,
        vendorAddress,
        state: 'SHIPPED',
      },
    });
    await repository.markDelivered(escrow.id, deliveredAt);
    if (Object.keys(after).length > 0) {
      await prisma.escrow.update({ where: { id: escrow.id }, data: after });
    }
    return escrow;
  };

  // ── (state, deliveredAt) index path ──────────────────────────────────────

  it('returns an escrow delivered more than 48 h ago', async () => {
    await deliver('widget-001', hours(50));

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(1);
    expect(results[0].state).toBe('DELIVERED');
  });

  it('excludes an escrow delivered less than 48 h ago (deliveredAt boundary)', async () => {
    await deliver('widget-002', hours(47));

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

  /**
   * Regression guard for #395. `markDelivered` is the only writer of
   * `deliveredAt`, and it sets DELIVERED in the same update, so the predicate
   * the query filters on has to be the state that method leaves behind. If the
   * two ever drift apart again the query silently returns nothing and
   * auto-release stops firing without any test going red.
   */
  it('selects exactly the state markDelivered produces', async () => {
    const escrow = await deliver('widget-006', hours(50));

    const delivered = await prisma.escrow.findUnique({
      where: { id: escrow.id },
    });
    expect(delivered!.state).toBe('DELIVERED');
    expect(delivered!.deliveredAt).not.toBeNull();

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(escrow.id);
  });

  it('excludes eligible escrow that already has autoReleaseTxHash', async () => {
    await deliver('widget-003', hours(50), {
      autoReleaseTxHash: 'existing-tx-hash',
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes eligible escrow that has autoReleaseSubmittedAt set (in-flight claim)', async () => {
    await deliver('widget-004', hours(50), {
      autoReleaseSubmittedAt: hours(1),
    });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('excludes eligible escrow that has disputeId set', async () => {
    await deliver('widget-005', hours(50), { disputeId: 'dispute-001' });

    const results = await repository.findAutoReleaseEligible(NOW);

    expect(results).toHaveLength(0);
  });

  it('returns only eligible rows when mixed data is present', async () => {
    const eligible = await deliver('eligible-001', hours(60));

    // Recent delivery — not yet past the 48-hour threshold
    await deliver('recent-001', hours(24), {
      buyerAddress: 'buyer-2',
      vendorAddress: 'vendor-2',
    });

    // Already released — txHash excludes it
    await deliver('released-001', hours(55), {
      buyerAddress: 'buyer-3',
      vendorAddress: 'vendor-3',
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
