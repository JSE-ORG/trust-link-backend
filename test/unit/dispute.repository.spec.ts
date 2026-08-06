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

    await expect(disputeRepository.findAllOpen()).resolves.toHaveLength(2);
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
});
