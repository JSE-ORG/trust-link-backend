import { PrismaService } from './prisma.service';

describe('PrismaService dispute.findFirst', () => {
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  it('returns the first dispute matching a multi-field where filter', async () => {
    await prisma.escrow.create({
      data: { id: 'escrow-1', itemName: 'Item', itemRef: 'ref-1', amount: 100, currency: 'USDC', buyerAddress: 'b1', vendorAddress: 'v1' },
    });
    await prisma.escrow.create({
      data: { id: 'escrow-2', itemName: 'Item', itemRef: 'ref-2', amount: 200, currency: 'USDC', buyerAddress: 'b2', vendorAddress: 'v2' },
    });
    await prisma.dispute.create({
      data: { escrowId: 'escrow-1', reason: 'Item not received' },
    });
    const resolved = await prisma.dispute.create({
      data: { escrowId: 'escrow-2', reason: 'Wrong item' },
    });
    await prisma.dispute.update({
      where: { id: resolved.id },
      data: { status: 'RESOLVED' },
    });

    const found = await prisma.dispute.findFirst({
      where: { status: 'RESOLVED' },
    });

    expect(found).not.toBeNull();
    expect(found?.escrowId).toBe('escrow-2');
    expect(found?.status).toBe('RESOLVED');
  });

  it('returns null when no dispute matches the where filter', async () => {
    await prisma.escrow.create({
      data: { id: 'escrow-1', itemName: 'Item', itemRef: 'ref-1', amount: 100, currency: 'USDC', buyerAddress: 'b1', vendorAddress: 'v1' },
    });
    await prisma.dispute.create({
      data: { escrowId: 'escrow-1', reason: 'Item not received' },
    });

    const found = await prisma.dispute.findFirst({
      where: { status: 'RESOLVED' },
    });

    expect(found).toBeNull();
  });
});
