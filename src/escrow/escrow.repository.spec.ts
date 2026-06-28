import { EscrowRepository } from './escrow.repository';
import { PrismaService } from '../prisma/prisma.service';

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
