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
});
