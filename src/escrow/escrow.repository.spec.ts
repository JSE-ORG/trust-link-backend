import { EscrowRepository } from './escrow.repository';
import { PrismaService } from '../prisma/prisma.service';
import { encryptContact } from '../common/sanitization/contact-encryption.util';

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

  beforeEach(() => {
    prisma = new PrismaService();
    repo = new EscrowRepository(prisma);
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

    it('returns only the first match when multiple records exist', async () => {
      await repo.create({ ...makeDto(), itemRef: 'REF-001' }, 'vendor-addr');
      await repo.create({ ...makeDto(), itemRef: 'REF-001' }, 'vendor-addr');

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
      const second = await repo.findByVendor('v-page', first[first.length - 1].id, 10);
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
      await repo.create({ ...makeDto(), itemRef: 'P', buyerAddress: 'b-page' }, 'v1');
      await repo.create({ ...makeDto(), itemRef: 'Q', buyerAddress: 'b-page' }, 'v1');
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
    it('returns the earliest record when multiple share the same (vendorAddress, itemRef)', async () => {
      const first = await repo.create({ ...makeDto(), itemRef: 'DUP' }, 'v-dup');
      await repo.create({ ...makeDto(), itemRef: 'DUP' }, 'v-dup');
      const found = await repo.findByVendorAndItem('v-dup', 'DUP');
      expect(found?.id).toBe(first.id);
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

    it('throws when plaintext email is passed directly to the repository', async () => {
      const escrow = await repo.create(makeDto(), 'v-enc2');
      await expect(
        repo.saveBuyerContact(escrow.id, 'plaintext@example.com', null),
      ).rejects.toThrow(/Security violation.*buyerContactEmail/);
    });

    it('throws when plaintext phone is passed directly to the repository', async () => {
      const escrow = await repo.create(makeDto(), 'v-enc3');
      await expect(
        repo.saveBuyerContact(escrow.id, null, '+2348001234567'),
      ).rejects.toThrow(/Security violation.*buyerContactPhone/);
    });

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
});
