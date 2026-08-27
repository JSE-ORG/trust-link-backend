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
    // beforeEach across ~100 suites, undisconnected clients exhaust PostgreS
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

      expect(found).notToBeNull();
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
      expect(found).notToBeNull();
      expect(found?.reason).toBe('Wrong item');
    });
  });

  describe('findByEscrowIds()', () => {
    it('returns disputes for a batch of escrows', async () => {
      const escrow1 = await escrowRepo.create(
        {
          itemName: 'Widget 1',
          itemRef: 'REF-3',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer1',
        },
        'vendor',
      );
      const escrow2 = await escrowRepo.create(
        {
          itemName: 'Widget 2',
          itemRef: 'REF-4',
          amount: 200,
          currency: 'USDC',
          buyerAddress: 'buyer2',
        },
        'vendor',
      );
      await disputeRepo.create({ escrowId: escrow1.id, reason: 'Not received' });

      const disputes = await disputeRepo.findByEscrowIds([escrow1.id, escrow2.id]);

      expect(disputes).toHaveLength(1);
      expect(disputes[0].escrowId).toBe(escrow1.id);
      expect(disputes[0].reason).toBe('Not received');
    });

    it('returns an empty array when none of the escrows have a dispute', async () => {
      const escrow1 = await escrowRepo.create(
        {
          itemName: 'Widget 3',
          itemRef: 'REF-5',
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'buyer3',
        },
        'vendor',
      );
      const escrow2 = await escrowRepo.create(
        {
          itemName: 'Widget 4',
          itemRef: 'REF-6',
          amount: 200,
          currency: 'USDC',
          buyerAddress: 'buyer4',
        },
        'vendor',
      );

      const disputes = await disputeRepo.findByEscrowIds([escrow1.id, escrow2.id]);

      expect(disputes).toEqual([]);
    });
  });
});
