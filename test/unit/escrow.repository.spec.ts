import { Test } from '@nestjs/testing';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('EscrowRepository (issue #13)', () => {
  let repository: EscrowRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EscrowRepository, PrismaService],
    }).compile();

    repository = moduleRef.get(EscrowRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.reset();
    await prisma.vendorProfile.createMany({
      data: [
        { address: 'vendor-1', businessName: 'Vendor 1' },
        { address: 'vendor-2', businessName: 'Vendor 2' },
      ],
      skipDuplicates: true,
    });
  });

  it('finds escrows by vendor and buyer', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Jacket',
        itemRef: 'ref-jacket',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
      },
    });
    await prisma.escrow.create({
      data: {
        itemName: 'Hat',
        itemRef: 'ref-hat',
        amount: 40,
        currency: 'USDC',
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-1',
      },
    });

    expect(await repository.findByVendor('vendor-1')).toHaveLength(2);
    expect(await repository.findByBuyer('buyer-2')).toHaveLength(1);
  });

  it('finds only shipped escrows delivered more than 48 hours ago without disputes', async () => {
    const eligible = await prisma.escrow.create({
      data: {
        itemName: 'Camera',
        itemRef: 'ref-camera-1',
        amount: 250,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        trackingId: 'TRK-1',
        deliveredAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.escrow.create({
      data: {
        itemName: 'Laptop',
        itemRef: 'ref-laptop',
        amount: 300,
        currency: 'USDC',
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        state: 'SHIPPED',
        trackingId: 'TRK-2',
        deliveredAt: new Date('2026-05-25T23:00:00.000Z'),
      },
    });
    const dispute = await prisma.dispute.create({
      data: {
        escrowId: eligible.id,
        reason: 'Item missing',
      },
    });
    // Mirror what production does: BuyerDisputeService links the dispute and
    // transitions the escrow (buyer-dispute.service.ts). The previous
    // in-memory PrismaService applied that side effect inside dispute.create
    // itself, so the test got it for free; the real client does not (#475).
    await prisma.escrow.update({
      where: { id: eligible.id },
      data: { disputeId: dispute.id, state: 'DISPUTED' },
    });

    const results = await repository.findAutoReleaseEligible(
      new Date('2026-05-26T00:00:00.000Z'),
    );

    expect(results).toHaveLength(0);
  });

  it('marks auto release completion atomically', async () => {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Camera',
        itemRef: 'ref-camera-2',
        amount: 250,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        state: 'SHIPPED',
        trackingId: 'TRK-1',
        deliveredAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const updated = await repository.markAutoReleaseCompleted(
      escrow.id,
      'tx-hash',
    );

    expect(updated.state).toBe('COMPLETED');
    expect(updated.autoReleaseTxHash).toBe('tx-hash');
  });

  it('orders event history oldest-first and breaks timestamp ties by id', async () => {
    const findMany = jest.spyOn(prisma.escrowEvent, 'findMany');

    // EscrowEvent.escrowId is a foreign key, so the parent escrow has to exist.
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Ordered',
        itemRef: 'ref-ordered',
        amount: 10,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
      },
    });

    // createdAt is supplied explicitly rather than driven by fake timers: the
    // first two share a timestamp so the id tie-break is what orders them, and
    // fake timers would stall the real database I/O this now performs (#475).
    const tie = new Date('2026-07-29T12:00:00.000Z');
    await prisma.escrowEvent.create({
      data: { escrowId: escrow.id, toState: 'FUNDED', createdAt: tie },
    });
    await prisma.escrowEvent.create({
      data: {
        escrowId: escrow.id,
        fromState: 'FUNDED',
        toState: 'SHIPPED',
        createdAt: tie,
      },
    });
    await prisma.escrowEvent.create({
      data: {
        escrowId: escrow.id,
        fromState: 'SHIPPED',
        toState: 'COMPLETED',
        createdAt: new Date('2026-07-29T13:00:00.000Z'),
      },
    });

    const events = await repository.findEvents(escrow.id);

    expect(events.map((event) => event.toState)).toEqual([
      'FUNDED',
      'SHIPPED',
      'COMPLETED',
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { escrowId: escrow.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });
});
