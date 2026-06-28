import { DisputeRepository } from './dispute.repository';
import { EscrowRepository } from '../escrow/escrow.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('DisputeRepository', () => {
  let disputeRepo: DisputeRepository;
  let escrowRepo: EscrowRepository;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = new PrismaService();
    disputeRepo = new DisputeRepository(prisma);
    escrowRepo = new EscrowRepository(prisma);
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
