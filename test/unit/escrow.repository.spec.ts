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
  });

  it('finds escrows by vendor and buyer', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Jacket',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'buyer-1',
        vendorAddress: 'vendor-1',
      },
    });
    await prisma.escrow.create({
      data: {
        itemName: 'Hat',
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
        amount: 300,
        currency: 'USDC',
        buyerAddress: 'buyer-2',
        vendorAddress: 'vendor-2',
        state: 'SHIPPED',
        trackingId: 'TRK-2',
        deliveredAt: new Date('2026-05-25T23:00:00.000Z'),
      },
    });
    await prisma.dispute.create({
      data: {
        escrowId: eligible.id,
        reason: 'Item missing',
      },
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
});
