import { DisputeRepository } from './dispute.repository';
import { EscrowRepository } from '../escrow/escrow.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('DisputeRepository', () => {
  let disputeRepo: DisputeRepository;
  let escrowRepo: EscrowRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    // State lives in a shared database now, not a per-instance Map, so a
    // suite that does not clear it inherits whatever the previous file left
    // behind — and jest's file ordering is not stable (#475).
    await prisma.reset();
    await prisma.vendorProfile.createMany({
      data: [{ address: 'vendor', businessName: 'Test Vendor' }],
      skipDuplicates: true,
    });
    disputeRepo = new DisputeRepository(prisma);
    escrowRepo = new EscrowRepository(prisma);
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool. Constructed in
    // beforeEach across ~100 suites, undisconnected clients exhaust Postgres
    // (`sorry, too many clients already`) partway through a full run.
    await prisma?.$disconnect();
  });

  describe('findByEscrow()', () => {
    it('returns the dispute linked to the given escrow', async () => {
      const escrow = await escrowRepo.create(
        {
          itemName: 'Widget',
          itemRef: 'REF-1',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer',
        },
        'vendor',
      );
      await disputeRepo.create({
        escrowId: escrow.id,
        reason: 'Item not received',
      });

      const found = await disputeRepo.findByEscrow(escrow.id);

      expect(found).not.toBeNull();
      expect(found?.escrowId).toBe(escrow.id);
      expect(found?.reason).toBe('Item not received');
    });

    it('returns null when no dispute exists for the escrow', async () => {
      const found = await disputeRepo.findByEscrow('nonexistent-escrow-id');
      expect(found).toBeNull();
    });

    it('uses the unique constraint — returns only one dispute per escrow', async () => {
      const escrow = await escrowRepo.create(
        {
          itemName: 'Widget',
          itemRef: 'REF-2',
          amount: 50,
          currency: 'USDC',
          buyerAddress: 'buyer',
        },
        'vendor',
      );
      await disputeRepo.create({ escrowId: escrow.id, reason: 'Wrong item' });

      const found = await disputeRepo.findByEscrow(escrow.id);
      expect(found).not.toBeNull();
      expect(found?.reason).toBe('Wrong item');
    });
  });
});
