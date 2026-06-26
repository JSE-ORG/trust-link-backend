import { Test } from '@nestjs/testing';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('DisputeRepository (issue #14)', () => {
  let disputeRepository: DisputeRepository;
  let escrowRepository: EscrowRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [DisputeRepository, EscrowRepository, PrismaService],
    }).compile();

    disputeRepository = moduleRef.get(DisputeRepository);
    escrowRepository = moduleRef.get(EscrowRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.reset();
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
