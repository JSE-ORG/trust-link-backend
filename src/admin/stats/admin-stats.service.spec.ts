import { AdminStatsService } from './admin-stats.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AdminStatsService', () => {
  let service: AdminStatsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
    service = new AdminStatsService(prisma);
  });

  afterEach(async () => {
    await prisma.reset();
  });

  it('returns zeros for an empty database', async () => {
    const stats = await service.getStats();

    expect(stats.totalEscrows).toBe(0);
    expect(stats.totalVolume).toBe(0);
    expect(stats.escrowsByState).toEqual({});
    expect(stats.uniqueVendors).toBe(0);
    expect(stats.uniqueBuyers).toBe(0);
    expect(stats.totalDisputes).toBe(0);
    expect(stats.openDisputes).toBe(0);
    expect(stats.averageEscrowAmount).toBe(0);
  });

  it('counts escrows across every EscrowState', async () => {
    const states = [
      'CREATED',
      'FUNDED',
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
      'RELEASED',
      'DISPUTED',
      'REFUNDED',
      'CANCELLED',
    ] as const;

    for (const state of states) {
      await prisma.escrow.create({
        data: {
          itemName: `item-${state}`,
          itemRef: `ref-${state}`,
          amount: 100,
          currency: 'USDC',
          buyerAddress: 'GBUYER1',
          vendorAddress: 'GVENDOR1',
          state,
          deliveredAt: null,
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          cancelledAt: null,
        },
      });
    }

    const stats = await service.getStats();

    expect(stats.totalEscrows).toBe(9);
    for (const state of states) {
      expect(stats.escrowsByState[state]).toBe(1);
    }
  });

  it('sums total volume from escrow amounts', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'item1',
        itemRef: 'ref-item1-a',
        amount: 250.5,
        currency: 'USDC',
        buyerAddress: 'GBUYER1',
        vendorAddress: 'GVENDOR1',
        state: 'FUNDED',
        deliveredAt: null,
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        cancelledAt: null,
      },
    });
    await prisma.escrow.create({
      data: {
        itemName: 'item2',
        itemRef: 'ref-item2-a',
        amount: 749.5,
        currency: 'USDC',
        buyerAddress: 'GBUYER2',
        vendorAddress: 'GVENDOR2',
        state: 'COMPLETED',
        deliveredAt: null,
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        cancelledAt: null,
      },
    });

    const stats = await service.getStats();

    expect(stats.totalVolume).toBe(1000);
    expect(stats.averageEscrowAmount).toBe(500);
  });

  it('counts unique vendors and buyers', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'item1',
        itemRef: 'ref-item1-b',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'GBUYER_A',
        vendorAddress: 'GVENDOR_A',
        state: 'FUNDED',
        deliveredAt: null,
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        cancelledAt: null,
      },
    });
    await prisma.escrow.create({
      data: {
        itemName: 'item2',
        itemRef: 'ref-item2-b',
        amount: 200,
        currency: 'USDC',
        buyerAddress: 'GBUYER_A',
        vendorAddress: 'GVENDOR_B',
        state: 'FUNDED',
        deliveredAt: null,
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        cancelledAt: null,
      },
    });

    const stats = await service.getStats();

    expect(stats.uniqueVendors).toBe(2);
    expect(stats.uniqueBuyers).toBe(1);
  });

  it('counts total and open disputes', async () => {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'item1',
        itemRef: 'ref-item1-c',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'GBUYER1',
        vendorAddress: 'GVENDOR1',
        state: 'DISPUTED',
        deliveredAt: null,
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        cancelledAt: null,
      },
    });

    await prisma.dispute.create({
      data: {
        escrowId: escrow.id,
        reason: 'Item not as described',
        status: 'OPEN',
      },
    });

    const escrow2 = await prisma.escrow.create({
      data: {
        itemName: 'item2',
        itemRef: 'ref-item2-c',
        amount: 200,
        currency: 'USDC',
        buyerAddress: 'GBUYER2',
        vendorAddress: 'GVENDOR2',
        state: 'DISPUTED',
        deliveredAt: null,
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        cancelledAt: null,
      },
    });

    await prisma.dispute.create({
      data: {
        escrowId: escrow2.id,
        reason: 'Item damaged',
        status: 'UNDER_REVIEW',
      },
    });

    await prisma.dispute.create({
      data: {
        escrowId: escrow.id,
        reason: 'Already resolved',
        status: 'RESOLVED',
      },
    });

    const stats = await service.getStats();

    expect(stats.totalDisputes).toBe(3);
    expect(stats.openDisputes).toBe(2);
  });

  it('matches the AdminStatsDto response shape', async () => {
    const stats = await service.getStats();

    expect(stats).toHaveProperty('totalEscrows');
    expect(stats).toHaveProperty('totalVolume');
    expect(stats).toHaveProperty('escrowsByState');
    expect(stats).toHaveProperty('uniqueVendors');
    expect(stats).toHaveProperty('uniqueBuyers');
    expect(stats).toHaveProperty('totalDisputes');
    expect(stats).toHaveProperty('openDisputes');
    expect(stats).toHaveProperty('averageEscrowAmount');

    expect(typeof stats.totalEscrows).toBe('number');
    expect(typeof stats.totalVolume).toBe('number');
    expect(typeof stats.escrowsByState).toBe('object');
    expect(typeof stats.uniqueVendors).toBe('number');
    expect(typeof stats.uniqueBuyers).toBe('number');
    expect(typeof stats.totalDisputes).toBe('number');
    expect(typeof stats.openDisputes).toBe('number');
    expect(typeof stats.averageEscrowAmount).toBe('number');
  });

  it('computes average escrow amount correctly with mixed amounts', async () => {
    const amounts = [100, 200, 300, 400, 500];
    for (const amount of amounts) {
      await prisma.escrow.create({
        data: {
          itemName: `item-${amount}`,
          itemRef: `ref-${amount}`,
          amount,
          currency: 'USDC',
          buyerAddress: 'GBUYER1',
          vendorAddress: 'GVENDOR1',
          state: 'FUNDED',
          deliveredAt: null,
          deliveryRecordedAt: null,
          autoReleaseSubmittedAt: null,
          autoReleaseTxHash: null,
          disputeId: null,
          cancelledAt: null,
        },
      });
    }

    const stats = await service.getStats();

    expect(stats.totalEscrows).toBe(5);
    expect(stats.totalVolume).toBe(1500);
    expect(stats.averageEscrowAmount).toBe(300);
  });

  it('counts disputes from dispute table, not inferred from escrow state', async () => {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'item1',
        itemRef: 'ref-item1-d',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'GBUYER1',
        vendorAddress: 'GVENDOR1',
        state: 'DISPUTED',
        deliveredAt: null,
        deliveryRecordedAt: null,
        autoReleaseSubmittedAt: null,
        autoReleaseTxHash: null,
        disputeId: null,
        cancelledAt: null,
      },
    });

    await prisma.dispute.create({
      data: {
        escrowId: escrow.id,
        reason: 'Test dispute',
        status: 'OPEN',
      },
    });

    const stats = await service.getStats();

    expect(stats.totalDisputes).toBe(1);
    expect(stats.openDisputes).toBe(1);
  });
});
