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

  /**
   * Fixtures go through `markDelivered` (issue #395). Writing `deliveredAt`
   * onto a SHIPPED row by hand produces a state the application cannot reach,
   * and every assertion below would then pass for the wrong reason: nothing
   * matches the query, so the dispute and recency filters are never exercised.
   */
  const deliver = async (
    data: {
      itemRef: string;
      buyerAddress: string;
      vendorAddress: string;
      trackingId: string;
    },
    deliveredAt: Date,
  ) => {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: data.itemRef,
        itemRef: data.itemRef,
        amount: 250,
        currency: 'USDC',
        buyerAddress: data.buyerAddress,
        vendorAddress: data.vendorAddress,
        trackingId: data.trackingId,
        state: 'SHIPPED',
      },
    });
    await repository.markDelivered(escrow.id, deliveredAt);
    return escrow;
  };

  it('finds only escrows delivered more than 48 hours ago without disputes', async () => {
    const disputed = await deliver(
      {
        itemRef: 'ref-camera-1',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-1',
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    // Delivered an hour before the reference time — inside the 48-hour window.
    await deliver(
      {
        itemRef: 'ref-laptop',
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        trackingId: 'TRK-2',
      },
      new Date('2026-05-25T23:00:00.000Z'),
    );

    // Past the window, undisputed: the one row that must come back.
    const eligible = await deliver(
      {
        itemRef: 'ref-tripod',
        buyerAddress: 'buyer-3',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-3',
      },
      new Date('2026-05-20T00:00:00.000Z'),
    );

    const dispute = await prisma.dispute.create({
      data: {
        escrowId: disputed.id,
        reason: 'Item missing',
      },
    });
    // Mirror what production does: BuyerDisputeService links the dispute and
    // transitions the escrow (buyer-dispute.service.ts). The previous
    // in-memory PrismaService applied that side effect inside dispute.create
    // itself, so the test got it for free; the real client does not (#475).
    await prisma.escrow.update({
      where: { id: disputed.id },
      data: { disputeId: dispute.id, state: 'DISPUTED' },
    });

    const results = await repository.findAutoReleaseEligible(
      new Date('2026-05-26T00:00:00.000Z'),
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(eligible.id);
  });

  it('marks auto release completion atomically', async () => {
    const escrow = await deliver(
      {
        itemRef: 'ref-camera-2',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
        trackingId: 'TRK-1',
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );

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
