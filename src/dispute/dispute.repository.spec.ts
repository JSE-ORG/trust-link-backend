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
      data: [
        { address: 'vendor', businessName: 'Test Vendor' },
        { address: 'vendor-1', businessName: 'Vendor 1' },
      ],
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

  // ── Ported from test/unit/dispute.repository.spec.ts (#752) ──────────────
  // That copy (4 tests, issue #14) owned findAllOpen/resolve coverage while
  // this file owned findByEscrow — no overlap, so all four cases move here.
  describe('findAllOpen()', () => {
    it('returns open disputes only', async () => {
      await prisma.escrow.createMany({
        data: [
          {
            id: 'escrow-1',
            itemName: 'Item 1',
            itemRef: 'ref-1',
            amount: 10,
            currency: 'USDC',
            buyerAddress: 'buyer-1',
            vendorAddress: 'vendor-1',
          },
          {
            id: 'escrow-2',
            itemName: 'Item 2',
            itemRef: 'ref-2',
            amount: 10,
            currency: 'USDC',
            buyerAddress: 'buyer-1',
            vendorAddress: 'vendor-1',
          },
          {
            id: 'escrow-3',
            itemName: 'Item 3',
            itemRef: 'ref-3',
            amount: 10,
            currency: 'USDC',
            buyerAddress: 'buyer-1',
            vendorAddress: 'vendor-1',
          },
        ],
      });
      await prisma.dispute.create({
        data: { escrowId: 'escrow-1', reason: 'Damaged parcel' },
      });
      await prisma.dispute.create({
        data: {
          escrowId: 'escrow-2',
          reason: 'Late delivery',
          status: 'UNDER_REVIEW',
        },
      });
      await prisma.dispute.create({
        data: {
          escrowId: 'escrow-3',
          reason: 'Resolved already',
          status: 'RESOLVED',
        },
      });

      const open = await disputeRepo.findAllOpen();
      expect(open).toHaveLength(2);
      // The filter is now a `where` clause (#670) — assert it still returns
      // exactly OPEN + UNDER_REVIEW and never a terminal status.
      expect(open.map((d) => d.status).sort()).toEqual([
        'OPEN',
        'UNDER_REVIEW',
      ]);
    });
  });

  describe('resolve()', () => {
    it('resolves the dispute and clears the escrow dispute link', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          itemName: 'Shoes',
          itemRef: 'ref-shoes',
          amount: 90,
          currency: 'USDC',
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          state: 'SHIPPED',
          trackingId: 'TRK-9',
        },
      });
      const dispute = await disputeRepo.create({
        escrowId: escrow.id,
        reason: 'Missing item',
      });

      await disputeRepo.resolve(dispute.id, 'RELEASED');

      const updatedEscrow = await escrowRepo.findById(escrow.id);
      expect(updatedEscrow?.state).toBe('RELEASED');
      expect(updatedEscrow?.disputeId).toBeNull();
      await expect(disputeRepo.findById(dispute.id)).resolves.toEqual(
        expect.objectContaining({ status: 'RESOLVED' }),
      );
    });

    it('resolves the dispute with default escrowState (COMPLETED)', async () => {
      const escrow = await prisma.escrow.create({
        data: {
          itemName: 'Laptop',
          itemRef: 'ref-laptop',
          amount: 500,
          currency: 'USDC',
          buyerAddress: 'buyer-1',
          vendorAddress: 'vendor-1',
          state: 'SHIPPED',
          trackingId: 'TRK-10',
        },
      });
      const dispute = await disputeRepo.create({
        escrowId: escrow.id,
        reason: 'Defective product',
      });

      // Call resolve without the escrowState parameter to test the default
      await disputeRepo.resolve(dispute.id);

      const updatedEscrow = await escrowRepo.findById(escrow.id);
      expect(updatedEscrow?.state).toBe('COMPLETED');
      expect(updatedEscrow?.disputeId).toBeNull();
      await expect(disputeRepo.findById(dispute.id)).resolves.toEqual(
        expect.objectContaining({ status: 'RESOLVED' }),
      );
    });

    it('throws when resolving a non-existent dispute', async () => {
      await expect(
        disputeRepo.resolve('non-existent-dispute-id'),
      ).rejects.toThrow('Dispute non-existent-dispute-id not found');
    });
  });
});
