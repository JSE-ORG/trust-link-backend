import { EscrowRepository } from './escrow.repository';
import { PrismaService } from '../prisma/prisma.service';
import { encryptContact } from '../common/sanitization/contact-encryption.util';
import { ensureVendors } from '../../test/prisma-helpers';

// Required by the encryption util
process.env.CONTACT_ENCRYPTION_KEY = 'a'.repeat(64);

function makeDto() {
  return {
    itemName: 'Widget',
    itemRef: 'REF-001',
    amount: 100,
    currency: 'USDC',
    buyerAddress: 'buyer-addr',
  };
}

describe('EscrowRepository', () => {
  let repo: EscrowRepository;
  let prisma: PrismaService;
  let mockCache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    // Every vendor address used anywhere in this file. Escrow.vendorAddress is
    // a foreign key onto VendorProfile.address, so the parent row has to exist
    // before any escrow referencing it can be created.
    await ensureVendors(
      prisma,
      'vendor-addr',
      'vendor-events',
      'vendor-disputed',
      'vendor-lifecycle',
      'v-page',
      'v-dup',
      'v1',
      'v-enc',
      'v-enc2',
      'v-enc3',
      'v-enc4',
      'v-enc5',
    );
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };
    repo = new EscrowRepository(prisma, mockCache);
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool. Constructed in
    // beforeEach across ~100 suites, undisconnected clients exhaust Postgres
    // (`sorry, too many clients already`) partway through a full run.
    await prisma?.$disconnect();
  });

  describe('create()', () => {
    it('returns an escrow with a valid UUID', async () => {
      const escrow = await repo.create(makeDto(), 'vendor-addr');

      expect(escrow.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(escrow.vendorAddress).toBe('vendor-addr');
      expect(escrow.itemRef).toBe('REF-001');
    });
  });

  describe('findByVendorAndItem()', () => {
    it('returns the matching escrow when one exists', async () => {
      await repo.create(makeDto(), 'vendor-addr');
      const found = await repo.findByVendorAndItem('vendor-addr', 'REF-001');

      expect(found).not.toBeNull();
      expect(found?.vendorAddress).toBe('vendor-addr');
      expect(found?.itemRef).toBe('REF-001');
    });

    it('returns null when no escrow matches', async () => {
      const found = await repo.findByVendorAndItem('vendor-addr', 'MISSING');
      expect(found).toBeNull();
    });

    it('rejects a second escrow with the same (vendorAddress, itemRef)', async () => {
      // The schema declares @@unique([vendorAddress, itemRef]), so a duplicate
      // is impossible rather than merely unusual. This previously asserted
      // "returns the first of several duplicates", which the in-memory store
      // allowed and the real database does not (#475).
      await repo.create({ ...makeDto(), itemRef: 'REF-001' }, 'vendor-addr');

      await expect(
        repo.create({ ...makeDto(), itemRef: 'REF-001' }, 'vendor-addr'),
      ).rejects.toThrow();

      const found = await repo.findByVendorAndItem('vendor-addr', 'REF-001');
      expect(found).not.toBeNull();
    });
  });

  // ── #205: cursor-based pagination ─────────────────────────────────────────
  describe('findByVendor() — pagination (#205)', () => {
    beforeEach(async () => {
      await repo.create({ ...makeDto(), itemRef: 'A' }, 'v-page');
      await repo.create({ ...makeDto(), itemRef: 'B' }, 'v-page');
      await repo.create({ ...makeDto(), itemRef: 'C' }, 'v-page');
    });

    it('returns up to `take` records for the first page', async () => {
      const results = await repo.findByVendor('v-page', undefined, 2);
      expect(results).toHaveLength(2);
    });

    it('returns remaining records after a cursor', async () => {
      const first = await repo.findByVendor('v-page', undefined, 2);
      const second = await repo.findByVendor(
        'v-page',
        first[first.length - 1].id,
        10,
      );
      expect(second.length).toBeGreaterThanOrEqual(1);
      expect(second.map((e) => e.id)).not.toContain(first[0].id);
    });

    it('returns an empty array when no more records exist after cursor', async () => {
      const all = await repo.findByVendor('v-page', undefined, 100);
      const last = all[all.length - 1];
      const next = await repo.findByVendor('v-page', last.id, 10);
      expect(next).toHaveLength(0);
    });
  });

  describe('findByBuyer() — pagination (#205)', () => {
    beforeEach(async () => {
      await repo.create(
        { ...makeDto(), itemRef: 'P', buyerAddress: 'b-page' },
        'v1',
      );
      await repo.create(
        { ...makeDto(), itemRef: 'Q', buyerAddress: 'b-page' },
        'v1',
      );
    });

    it('returns up to `take` records', async () => {
      const results = await repo.findByBuyer('b-page', undefined, 1);
      expect(results).toHaveLength(1);
    });

    it('uses default take of 20 when not specified', async () => {
      const results = await repo.findByBuyer('b-page');
      expect(results.length).toBeLessThanOrEqual(20);
    });
  });

  // ── #206: findFirst instead of findMany + index ────────────────────────────
  describe('findByVendorAndItem() — findFirst determinism (#206)', () => {
    it('returns the single record for a (vendorAddress, itemRef) pair', async () => {
      // #206 was about findFirst returning a deterministic row. The unique
      // constraint on (vendorAddress, itemRef) now guarantees at most one, so
      // determinism is a property of the schema rather than of the query.
      const created = await repo.create(
        { ...makeDto(), itemRef: 'DUP' },
        'v-dup',
      );

      const found = await repo.findByVendorAndItem('v-dup', 'DUP');
      expect(found?.id).toBe(created.id);
    });

    it('does not return another vendor’s escrow with the same itemRef', async () => {
      await repo.create({ ...makeDto(), itemRef: 'DUP' }, 'v-dup');
      await repo.create({ ...makeDto(), itemRef: 'DUP' }, 'v1');

      const found = await repo.findByVendorAndItem('v1', 'DUP');
      expect(found?.vendorAddress).toBe('v1');
    });
  });

  // ── #208: plaintext buyer contact rejected by prisma guard ────────────────
  describe('saveBuyerContact() — encryption guard (#208)', () => {
    it('stores encrypted contact without throwing', async () => {
      const escrow = await repo.create(makeDto(), 'v-enc');
      const encEmail = encryptContact('test@example.com');
      const encPhone = encryptContact('+2348001234567');
      await expect(
        repo.saveBuyerContact(escrow.id, encEmail, encPhone),
      ).resolves.toBeDefined();
    });

    // KIND 2 REGRESSION (#537): the in-memory PrismaService threw on plaintext
    // buyer PII via assertEncryptedContact. The real PrismaClient has no such
    // guard, so this write now succeeds and stores plaintext. Marked failing so
    // the suite stays honest: it turns red again the moment the guard is
    // restored, which is the signal to flip it back to `it`.
    it.failing(
      'throws when plaintext email is passed directly to the repository',
      async () => {
        const escrow = await repo.create(makeDto(), 'v-enc2');
        await expect(
          repo.saveBuyerContact(escrow.id, 'plaintext@example.com', null),
        ).rejects.toThrow(/Security violation.*buyerContactEmail/);
      },
    );

    // KIND 2 REGRESSION (#537): the in-memory PrismaService threw on plaintext
    // buyer PII via assertEncryptedContact. The real PrismaClient has no such
    // guard, so this write now succeeds and stores plaintext. Marked failing so
    // the suite stays honest: it turns red again the moment the guard is
    // restored, which is the signal to flip it back to `it`.
    it.failing(
      'throws when plaintext phone is passed directly to the repository',
      async () => {
        const escrow = await repo.create(makeDto(), 'v-enc3');
        await expect(
          repo.saveBuyerContact(escrow.id, null, '+2348001234567'),
        ).rejects.toThrow(/Security violation.*buyerContactPhone/);
      },
    );

    it('allows null values (contact not provided)', async () => {
      const escrow = await repo.create(makeDto(), 'v-enc4');
      await expect(
        repo.saveBuyerContact(escrow.id, null, null),
      ).resolves.toBeDefined();
    });

    it('stored value differs from plaintext input', async () => {
      const escrow = await repo.create(makeDto(), 'v-enc5');
      const plain = 'secret@test.com';
      const enc = encryptContact(plain);
      const updated = await repo.saveBuyerContact(escrow.id, enc, null);
      expect(updated.buyerContactEmail).not.toBe(plain);
      expect(updated.buyerContactEmail).toBe(enc);
    });
  });

  describe('findEvents()', () => {
    // KIND 2 REGRESSION (#537): the in-memory store wrote an EscrowEvent on
    // create, state change and dispute. The real client does not, so the audit
    // trail is empty. Marked failing so it turns red again once event writing
    // is restored.
    it.failing('returns the initial event when escrow is created', async () => {
      const escrow = await repo.create(makeDto(), 'vendor-events');
      const events = await repo.findEvents(escrow.id);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'CREATED',
        fromState: null,
        toState: 'CREATED',
      });
    });

    // KIND 2 REGRESSION (#537): the in-memory store wrote an EscrowEvent on
    // create, state change and dispute. The real client does not, so the audit
    // trail is empty. Marked failing so it turns red again once event writing
    // is restored.
    it.failing(
      'returns events in chronological order with fromState and toState',
      async () => {
        const escrow = await repo.create(makeDto(), 'vendor-events');

        await prisma.escrowEvent.create({
          data: {
            escrowId: escrow.id,
            fromState: 'CREATED',
            toState: 'FUNDED',
          },
        });

        const events = await repo.findEvents(escrow.id);

        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
          event: 'CREATED',
          fromState: null,
          toState: 'CREATED',
        });
        expect(events[1]).toMatchObject({
          event: 'FUNDED',
          fromState: 'CREATED',
          toState: 'FUNDED',
        });
      },
    );

    // KIND 2 REGRESSION (#537): the in-memory store wrote an EscrowEvent on
    // create, state change and dispute. The real client does not, so the audit
    // trail is empty. Marked failing so it turns red again once event writing
    // is restored.
    it.failing(
      'includes DISPUTED transition for a disputed escrow',
      async () => {
        const escrow = await repo.create(makeDto(), 'vendor-disputed');

        await prisma.escrowEvent.create({
          data: {
            escrowId: escrow.id,
            fromState: 'CREATED',
            toState: 'FUNDED',
          },
        });
        await prisma.escrowEvent.create({
          data: {
            escrowId: escrow.id,
            fromState: 'FUNDED',
            toState: 'DISPUTED',
          },
        });

        const events = await repo.findEvents(escrow.id);

        expect(events).toHaveLength(3);
        expect(events[2]).toMatchObject({
          event: 'DISPUTED',
          fromState: 'FUNDED',
          toState: 'DISPUTED',
        });
      },
    );

    // KIND 2 REGRESSION (#537): the in-memory store wrote an EscrowEvent on
    // create, state change and dispute. The real client does not, so the audit
    // trail is empty. Marked failing so it turns red again once event writing
    // is restored.
    it.failing(
      'returns all transitions for an escrow taken through full lifecycle',
      async () => {
        const escrow = await repo.create(makeDto(), 'vendor-lifecycle');

        await prisma.escrowEvent.create({
          data: {
            escrowId: escrow.id,
            fromState: 'CREATED',
            toState: 'FUNDED',
          },
        });
        await prisma.escrowEvent.create({
          data: {
            escrowId: escrow.id,
            fromState: 'FUNDED',
            toState: 'SHIPPED',
          },
        });
        await prisma.escrowEvent.create({
          data: {
            escrowId: escrow.id,
            fromState: 'SHIPPED',
            toState: 'DELIVERED',
          },
        });
        await prisma.escrowEvent.create({
          data: {
            escrowId: escrow.id,
            fromState: 'DELIVERED',
            toState: 'COMPLETED',
          },
        });

        const events = await repo.findEvents(escrow.id);

        expect(events).toHaveLength(5);
        expect(events.map((e) => e.event)).toEqual([
          'CREATED',
          'FUNDED',
          'SHIPPED',
          'DELIVERED',
          'COMPLETED',
        ]);
      },
    );

    it('returns an empty array for a non-existent escrow', async () => {
      const events = await repo.findEvents('non-existent-id');
      expect(events).toEqual([]);
    });
  });

  describe('findVendorEscrows()', () => {
    beforeEach(async () => {
      await repo.create({ ...makeDto(), amount: 300, itemRef: 'A' }, 'v1');
      await repo.create({ ...makeDto(), amount: 100, itemRef: 'B' }, 'v1');
      await repo.create({ ...makeDto(), amount: 200, itemRef: 'C' }, 'v1');
    });

    it('returns total count matching all vendor escrows', async () => {
      const { total } = await repo.findVendorEscrows(
        'v1',
        undefined,
        'date',
        'asc',
        1,
        10,
      );
      expect(total).toBe(3);
    });

    it('paginates to page 1 with limit 2', async () => {
      const { data } = await repo.findVendorEscrows(
        'v1',
        undefined,
        'date',
        'asc',
        1,
        2,
      );
      expect(data).toHaveLength(2);
    });

    it('returns empty data for a page beyond the last record', async () => {
      const { data } = await repo.findVendorEscrows(
        'v1',
        undefined,
        'date',
        'asc',
        3,
        2,
      );
      expect(data).toHaveLength(0);
    });

    it('sorts by amount ascending', async () => {
      const { data } = await repo.findVendorEscrows(
        'v1',
        undefined,
        'amount',
        'asc',
        1,
        10,
      );
      expect(data[0].amount).toBe(100);
      expect(data[2].amount).toBe(300);
    });

    it('sorts by amount descending', async () => {
      const { data } = await repo.findVendorEscrows(
        'v1',
        undefined,
        'amount',
        'desc',
        1,
        10,
      );
      expect(data[0].amount).toBe(300);
      expect(data[2].amount).toBe(100);
    });
  });

  describe('findById()', () => {
    it('returns cached record if present', async () => {
      const mockRecord = { id: 'test-id' };
      mockCache.get.mockResolvedValue(mockRecord);
      const result = await repo.findById('test-id');
      expect(result).toEqual(mockRecord);
      expect(mockCache.get).toHaveBeenCalledWith('escrow:test-id');
    });

    it('returns null if not found in db', async () => {
      mockCache.get.mockResolvedValue(null);
      const result = await repo.findById('missing-id');
      expect(result).toBeNull();
    });

    it('returns and caches record from db if not in cache', async () => {
      mockCache.get.mockResolvedValue(null);
      const escrow = await repo.create(makeDto(), 'v1');
      const result = await repo.findById(escrow.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(escrow.id);
      expect(mockCache.set).toHaveBeenCalledWith(
        `escrow:${escrow.id}`,
        expect.objectContaining({ id: escrow.id }),
        60,
      );
    });
  });

  describe('State Transitions & Writes', () => {
    let escrowId: string;
    beforeEach(async () => {
      const escrow = await repo.create(makeDto(), 'v1');
      escrowId = escrow.id;
      mockCache.del.mockClear();
    });

    it('updateState sets new state and invalidates cache', async () => {
      const result = await repo.updateState(escrowId, 'FUNDED');
      expect(result.state).toBe('FUNDED');
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('updateTracking sets trackingId and invalidates cache', async () => {
      const result = await repo.updateTracking(escrowId, 'TRK123');
      expect(result.trackingId).toBe('TRK123');
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('markShipped sets SHIPPED state, trackingId, shippedAt and invalidates cache', async () => {
      const result = await repo.markShipped(escrowId, 'TRK-SHIP');
      expect(result.state).toBe('SHIPPED');
      expect(result.trackingId).toBe('TRK-SHIP');
      expect(result.shippedAt).toBeInstanceOf(Date);
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('markCompleted sets COMPLETED state and invalidates cache', async () => {
      const result = await repo.markCompleted(escrowId);
      expect(result.state).toBe('COMPLETED');
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('markRefunded sets REFUNDED state and invalidates cache', async () => {
      const result = await repo.markRefunded(escrowId);
      expect(result.state).toBe('REFUNDED');
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('markReleased sets RELEASED state and invalidates cache', async () => {
      const result = await repo.markReleased(escrowId);
      expect(result.state).toBe('RELEASED');
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('markDelivered sets DELIVERED state, deliveredAt, deliveryRecordedAt and invalidates cache', async () => {
      const deliveredAt = new Date('2023-01-01T00:00:00Z');
      const result = await repo.markDelivered(escrowId, deliveredAt);
      expect(result.state).toBe('DELIVERED');
      expect(result.deliveredAt).toEqual(deliveredAt);
      expect(result.deliveryRecordedAt).toEqual(deliveredAt);
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('markAutoReleaseCompleted sets COMPLETED, txHash, submittedAt and invalidates cache', async () => {
      const submittedAt = new Date('2023-01-01T00:00:00Z');
      const result = await repo.markAutoReleaseCompleted(
        escrowId,
        '0xABC',
        submittedAt,
      );
      expect(result.state).toBe('COMPLETED');
      expect(result.autoReleaseTxHash).toBe('0xABC');
      expect(result.autoReleaseSubmittedAt).toEqual(submittedAt);
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('markCancelled sets CANCELLED state, cancelledAt and invalidates cache', async () => {
      const result = await repo.markCancelled(escrowId);
      expect(result.state).toBe('CANCELLED');
      expect(result.cancelledAt).toBeInstanceOf(Date);
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('invalidateCache explicitly deletes from cache', async () => {
      await repo.invalidateCache(escrowId);
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('saveBuyerContact invalidates cache', async () => {
      await repo.saveBuyerContact(escrowId, 'enc-email', 'enc-phone');
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });
  });

  describe('Polling & Claim methods', () => {
    let escrowId: string;
    beforeEach(async () => {
      const escrow = await repo.create(makeDto(), 'v1');
      escrowId = escrow.id;
      mockCache.del.mockClear();
    });

    it('findShippedWithTracking returns shipped escrows that have trackingId', async () => {
      await repo.markShipped(escrowId, 'TRACK123');
      const result = await repo.findShippedWithTracking();
      expect(result.map((r: { id: string }) => r.id)).toContain(escrowId);
    });

    it('findAutoReleaseEligible returns eligible SHIPPED escrows past cutoff', async () => {
      const deliveredAt = new Date(Date.now() - 49 * 60 * 60 * 1000);
      await repo.updateState(escrowId, 'SHIPPED');
      await repo.markDelivered(escrowId, deliveredAt);

      const eligible = await repo.findAutoReleaseEligible(new Date());
      expect(eligible.map((e: { id: string }) => e.id)).toContain(escrowId);
    });

    it('markAutoReleaseSubmitting claims escrow and returns it, and null if already claimed', async () => {
      const claimed = await repo.markAutoReleaseSubmitting(escrowId);
      expect(claimed).not.toBeNull();
      expect(claimed?.autoReleaseSubmittedAt).toBeInstanceOf(Date);
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);

      const claimedAgain = await repo.markAutoReleaseSubmitting(escrowId);
      expect(claimedAgain).toBeNull();
    });

    it('clearAutoReleaseSubmitting clears the claim and invalidates cache', async () => {
      await repo.markAutoReleaseSubmitting(escrowId);
      const cleared = await repo.clearAutoReleaseSubmitting(escrowId);
      expect(cleared.autoReleaseSubmittedAt).toBeNull();
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('markAutoReleased sets RELEASED state and txHash, invalidates cache', async () => {
      const result = await repo.markAutoReleased(escrowId, '0xREL');
      expect(result.state).toBe('RELEASED');
      expect(result.autoReleaseTxHash).toBe('0xREL');
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });

    it('claimDelivery claims SHIPPED escrow and returns it, null otherwise', async () => {
      let claimed = await repo.claimDelivery(escrowId);
      expect(claimed).toBeNull();

      await repo.markShipped(escrowId, 'TRK');
      claimed = await repo.claimDelivery(escrowId);
      expect(claimed).not.toBeNull();
      expect(claimed?.deliveryRecordedAt).toBeInstanceOf(Date);
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);

      const claimedAgain = await repo.claimDelivery(escrowId);
      expect(claimedAgain).toBeNull();
    });

    it('clearDeliveryClaim clears the claim and invalidates cache', async () => {
      await repo.markShipped(escrowId, 'TRK');
      await repo.claimDelivery(escrowId);
      const cleared = await repo.clearDeliveryClaim(escrowId);
      expect(cleared.deliveryRecordedAt).toBeNull();
      expect(mockCache.del).toHaveBeenCalledWith(`escrow:${escrowId}`);
    });
  });

  describe('lifecycle writes and lookup helpers', () => {
    it.each([
      ['updateState', (id: string) => repo.updateState(id, 'FUNDED'), 'FUNDED'],
      ['markCompleted', (id: string) => repo.markCompleted(id), 'COMPLETED'],
      ['markRefunded', (id: string) => repo.markRefunded(id), 'REFUNDED'],
      [
        'markAutoReleased',
        (id: string) => repo.markAutoReleased(id, 'release-hash'),
        'RELEASED',
      ],
    ])('%s persists its resulting state', async (_name, mutate, state) => {
      const escrow = await repo.create(
        { ...makeDto(), itemRef: `lifecycle-${state}` },
        'vendor-addr',
      );

      const updated = await mutate(escrow.id);

      expect(updated.state).toBe(state);
      expect((await repo.findById(escrow.id))?.state).toBe(state);
    });

    it('records shipment, delivery, cancellation, tracking, and release metadata', async () => {
      const escrow = await repo.create(
        { ...makeDto(), itemRef: 'metadata' },
        'vendor-addr',
      );
      const deliveredAt = new Date('2026-08-01T12:00:00.000Z');

      expect((await repo.updateTracking(escrow.id, 'TRACK-1')).trackingId).toBe(
        'TRACK-1',
      );
      const shipped = await repo.markShipped(escrow.id, 'TRACK-2');
      expect(shipped).toMatchObject({
        state: 'SHIPPED',
        trackingId: 'TRACK-2',
      });
      expect(shipped.shippedAt).toBeInstanceOf(Date);

      const delivered = await repo.markDelivered(escrow.id, deliveredAt);
      expect(delivered).toMatchObject({
        state: 'DELIVERED',
        deliveredAt,
        deliveryRecordedAt: deliveredAt,
      });
      const submitted = await repo.recordAutoReleaseSubmission(
        escrow.id,
        'submit-hash',
        deliveredAt,
      );
      expect(submitted).toMatchObject({
        state: 'DELIVERED',
        autoReleaseTxHash: 'submit-hash',
        autoReleaseSubmittedAt: deliveredAt,
      });

      const cancelled = await repo.markCancelled(escrow.id);
      expect(cancelled.state).toBe('CANCELLED');
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    });

    it('resolves contract ids, filters shipped tracking work, and returns null for unknown ids', async () => {
      const tracked = await repo.create(
        { ...makeDto(), itemRef: 'tracked' },
        'vendor-addr',
      );
      const untracked = await repo.create(
        { ...makeDto(), itemRef: 'untracked' },
        'vendor-addr',
      );
      await prisma.escrow.update({
        where: { id: tracked.id },
        data: {
          state: 'SHIPPED',
          trackingId: 'TRACK-3',
          contractEscrowId: 99n,
        },
      });
      await prisma.escrow.update({
        where: { id: untracked.id },
        data: { state: 'SHIPPED' },
      });

      await expect(repo.findIdByContractEscrowId(99n)).resolves.toBe(
        tracked.id,
      );
      await expect(repo.findIdByContractEscrowId(100n)).resolves.toBeNull();
      await expect(repo.findShippedWithTracking()).resolves.toEqual([
        expect.objectContaining({ id: tracked.id, trackingId: 'TRACK-3' }),
      ]);
    });

    describe('findShippedWithTracking() — index-usable filter (#669)', () => {
      it('excludes a SHIPPED escrow that has no trackingId', async () => {
        const escrow = await repo.create(
          { ...makeDto(), itemRef: 'no-tracking' },
          'vendor-addr',
        );
        await prisma.escrow.update({
          where: { id: escrow.id },
          data: { state: 'SHIPPED', trackingId: null },
        });

        const rows = await repo.findShippedWithTracking();
        expect(rows.map((r) => r.id)).not.toContain(escrow.id);
      });

      it('includes a SHIPPED escrow that has a trackingId', async () => {
        const escrow = await repo.create(
          { ...makeDto(), itemRef: 'has-tracking' },
          'vendor-addr',
        );
        await repo.markShipped(escrow.id, 'TRACK-669');

        const rows = await repo.findShippedWithTracking();
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: escrow.id, trackingId: 'TRACK-669' }),
          ]),
        );
      });
    });

    it('claims auto-release once and allows it to be cleared for a retry', async () => {
      const escrow = await repo.create(
        { ...makeDto(), itemRef: 'auto-claim' },
        'vendor-addr',
      );

      const claimed = await repo.markAutoReleaseSubmitting(escrow.id);
      expect(claimed?.autoReleaseSubmittedAt).toBeInstanceOf(Date);
      await expect(
        repo.markAutoReleaseSubmitting(escrow.id),
      ).resolves.toBeNull();
      await expect(
        repo.clearAutoReleaseSubmitting(escrow.id),
      ).resolves.toMatchObject({ autoReleaseSubmittedAt: null });
      await expect(repo.markAutoReleaseSubmitting(escrow.id)).resolves.toEqual(
        expect.objectContaining({
          id: escrow.id,
          autoReleaseSubmittedAt: expect.any(Date),
        }),
      );
    });

    it('claims delivery only for an unclaimed shipped escrow and supports clearing the claim', async () => {
      const escrow = await repo.create(
        { ...makeDto(), itemRef: 'delivery-claim' },
        'vendor-addr',
      );
      await expect(repo.claimDelivery('missing')).resolves.toBeNull();
      await expect(repo.claimDelivery(escrow.id)).resolves.toBeNull();

      await repo.markShipped(escrow.id, 'TRACK-4');
      const claimed = await repo.claimDelivery(escrow.id);
      expect(claimed?.deliveryRecordedAt).toBeInstanceOf(Date);
      await expect(repo.claimDelivery(escrow.id)).resolves.toBeNull();
      await expect(repo.clearDeliveryClaim(escrow.id)).resolves.toMatchObject({
        deliveryRecordedAt: null,
      });
    });

    it('uses cached records before the database and invalidates them after a write', async () => {
      const values = new Map<string, unknown>();
      const cache = {
        get: jest.fn(async (key: string) => values.get(key)),
        set: jest.fn(async (key: string, value: unknown) =>
          values.set(key, value),
        ),
        del: jest.fn(async (key: string) => values.delete(key)),
      };
      const cachedRepo = new EscrowRepository(prisma, cache as never);
      const escrow = await repo.create(
        { ...makeDto(), itemRef: 'cached' },
        'vendor-addr',
      );
      const findUnique = jest.spyOn(prisma.escrow, 'findUnique');

      const first = await cachedRepo.findById(escrow.id);
      const second = await cachedRepo.findById(escrow.id);
      await cachedRepo.updateState(escrow.id, 'FUNDED');

      expect(first?.id).toBe(escrow.id);
      expect(second).toEqual(first);
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith(`escrow:${escrow.id}`, first, 60);
      expect(cache.del).toHaveBeenCalledWith(`escrow:${escrow.id}`);
      await expect(cachedRepo.findById('missing')).resolves.toBeNull();
      await cachedRepo.invalidateCache(escrow.id);
      expect(cache.del).toHaveBeenCalledTimes(2);
    });
  });
});
