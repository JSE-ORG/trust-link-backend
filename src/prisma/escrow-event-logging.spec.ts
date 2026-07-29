import { PrismaService } from './prisma.service';

describe('PrismaService basic CRUD', () => {
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.reset();
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  it('creates and reads an escrow', async () => {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Widget',
        itemRef: 'ref-1',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'GBUYER',
        vendorAddress: 'GVENDOR',
      },
    });
    expect(escrow.id).toBeDefined();
    expect(escrow.state).toBe('CREATED');

    const found = await prisma.escrow.findUnique({ where: { id: escrow.id } });
    expect(found).not.toBeNull();
    expect(found!.itemName).toBe('Widget');
  });

  it('creates and reads a dispute linked to an escrow', async () => {
    const escrow = await prisma.escrow.create({
      data: {
        itemName: 'Widget',
        itemRef: 'ref-1',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'GBUYER',
        vendorAddress: 'GVENDOR',
      },
    });
    const dispute = await prisma.dispute.create({
      data: { escrowId: escrow.id, reason: 'Item not received' },
    });
    expect(dispute.id).toBeDefined();
    expect(dispute.escrowId).toBe(escrow.id);
  });

  it('resets all tables', async () => {
    await prisma.escrow.create({
      data: {
        itemName: 'Widget',
        itemRef: 'ref-1',
        amount: 100,
        currency: 'USDC',
        buyerAddress: 'GBUYER',
        vendorAddress: 'GVENDOR',
      },
    });
    await prisma.reset();
    const all = await prisma.escrow.findMany();
    expect(all).toHaveLength(0);
  });
});
