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

  describe('findMany() and count() (issue #926)', () => {
    async function seedDisputes() {
      const escrowA = await escrowRepo.create(
        {
          itemName: 'A',
          itemRef: 'MANY-A',
          amount: 10,
          currency: 'USDC',
          buyerAddress: 'buyer',
        },
        'vendor',
      );
      const escrowB = await escrowRepo.create(
        {
          itemName: 'B',
          itemRef: 'MANY-B',
          amount: 20,
          currency: 'USDC',
          buyerAddress: 'buyer',
        },
        'vendor',
      );
      await disputeRepo.create({
        escrowId: escrowA.id,
        reason: 'open one',
        status: 'OPEN',
      });
      await disputeRepo.create({
        escrowId: escrowB.id,
        reason: 'reviewed one',
        status: 'UNDER_REVIEW',
      });
      return { escrowA, escrowB };
    }

    it('returns every dispute when no where filter is supplied', async () => {
      await seedDisputes();

      const rows = await disputeRepo.findMany();

      expect(rows).toHaveLength(2);
    });

    it('filters by status', async () => {
      await seedDisputes();

      const rows = await disputeRepo.findMany({
        where: { status: 'UNDER_REVIEW' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('UNDER_REVIEW');
      expect(rows[0].reason).toBe('reviewed one');
    });

    it('honours take for pagination', async () => {
      await seedDisputes();

      const rows = await disputeRepo.findMany({
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      expect(rows).toHaveLength(1);
    });

    it('counts all disputes with no filter and only the matching ones with a where', async () => {
      await seedDisputes();

      expect(await disputeRepo.count()).toBe(2);
      expect(await disputeRepo.count({ status: 'OPEN' })).toBe(1);
      expect(await disputeRepo.count({ status: 'RESOLVED' })).toBe(0);
    });
  });

  describe('findFirst() (issue #926)', () => {
    it('returns the first dispute matching the where clause', async () => {
      const escrow = await escrowRepo.create(
        {
          itemName: 'Widget',
          itemRef: 'FIRST-1',
          amount: 30,
          currency: 'USDC',
          buyerAddress: 'buyer',
        },
        'vendor',
      );
      await disputeRepo.create({
        escrowId: escrow.id,
        reason: 'under review dispute',
        status: 'UNDER_REVIEW',
      });

      const found = await disputeRepo.findFirst({
        where: {
          escrowId: escrow.id,
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
        },
      });

      expect(found).not.toBeNull();
      expect(found?.escrowId).toBe(escrow.id);
      expect(found?.status).toBe('UNDER_REVIEW');
    });

    it('returns null when nothing matches', async () => {
      const found = await disputeRepo.findFirst({
        where: { escrowId: 'nonexistent-escrow-id', status: 'OPEN' },
      });

      expect(found).toBeNull();
    });
  });

  describe('update() (issue #926)', () => {
    it('marks a dispute RESOLVED with a resolvedAt timestamp', async () => {
      const escrow = await escrowRepo.create(
        {
          itemName: 'Widget',
          itemRef: 'UPD-1',
          amount: 40,
          currency: 'USDC',
          buyerAddress: 'buyer',
        },
        'vendor',
      );
      const created = await disputeRepo.create({
        escrowId: escrow.id,
        reason: 'to be resolved',
        status: 'UNDER_REVIEW',
      });

      const resolvedAt = new Date();
      const updated = await disputeRepo.update({
        where: { id: created.id },
        data: { status: 'RESOLVED', resolvedAt },
      });

      expect(updated.status).toBe('RESOLVED');
      expect(updated.resolvedAt).toEqual(resolvedAt);

      const reloaded = await disputeRepo.findById(created.id);
      expect(reloaded?.status).toBe('RESOLVED');
      expect(reloaded?.resolvedAt).toEqual(resolvedAt);
    });
  });
});
