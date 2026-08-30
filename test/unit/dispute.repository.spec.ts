import { Test } from '@nestjs/testing';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('DisputeRepository (issue #14)', () => {
  let disputeRepository: DisputeRepository;
  let escrowRepository: EscrowRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DisputeRepository,
        EscrowRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    disputeRepository = moduleRef.get(DisputeRepository);
    escrowRepository = moduleRef.get(EscrowRepository);
    await prisma.reset();
    await prisma.vendorProfile.createMany({
      data: [{ address: 'vendor-1', businessName: 'Vendor 1' }],
      skipDuplicates: true,
    });
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
  });

  afterEach(async () => {
    // Each `new PrismaService()` opens its own connection pool. Constructed in
    // beforeEach across ~100 suites, undisconnected clients exhaust Postgres
    // (`sorry, too many clients already`) partway through a full run.
    await prisma?.$disconnect();
  });

  it('returns open disputes only', async () => {
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

    const open = await disputeRepository.findAllOpen();
    expect(open).toHaveLength(2);
    // The filter is now a `where` clause (#670) — assert it still returns
    // exactly OPEN + UNDER_REVIEW and never a terminal status.
    expect(open.map((d) => d.status).sort()).toEqual(['OPEN', 'UNDER_REVIEW']);
  });

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
    const dispute = await disputeRepository.create({
      escrowId: escrow.id,
      reason: 'Missing item',
    });

    await disputeRepository.resolve(dispute.id, 'RELEASED');

    const updatedEscrow = await escrowRepository.findById(escrow.id);
    expect(updatedEscrow?.state).toBe('RELEASED');
    expect(updatedEscrow?.disputeId).toBeNull();
    await expect(disputeRepository.findById(dispute.id)).resolves.toEqual(
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
    const dispute = await disputeRepository.create({
      escrowId: escrow.id,
      reason: 'Defective product',
    });

    // Call resolve without the escrowState parameter to test the default
    await disputeRepository.resolve(dispute.id);

    const updatedEscrow = await escrowRepository.findById(escrow.id);
    expect(updatedEscrow?.state).toBe('COMPLETED');
    expect(updatedEscrow?.disputeId).toBeNull();
    await expect(disputeRepository.findById(dispute.id)).resolves.toEqual(
      expect.objectContaining({ status: 'RESOLVED' }),
    );
  });

  it('throws when resolving a non-existent dispute', async () => {
    await expect(disputeRepository.resolve('non-existent-dispute-id')).rejects.toThrow(
      'Dispute non-existent-dispute-id not found',
    );
  });
});
