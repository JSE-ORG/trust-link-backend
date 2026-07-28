import { PrismaService } from './prisma.service';

describe('PrismaService dispute.findFirst', () => {
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = new PrismaService();
  });

  it('returns the first dispute matching a multi-field where filter', async () => {
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
    await prisma.dispute.create({
      data: { escrowId: 'escrow-1', reason: 'Item not received' },
    });

    const found = await prisma.dispute.findFirst({
      where: { status: 'RESOLVED' },
    });

    expect(found).toBeNull();
  });

  it('delegates to findMany so the same filtering logic applies to both', async () => {
    const findManySpy = jest.spyOn(prisma.dispute, 'findMany');
    await prisma.dispute.create({
      data: { escrowId: 'escrow-1', reason: 'Item not received' },
    });

    await prisma.dispute.findFirst({ where: { escrowId: 'escrow-1' } });

    expect(findManySpy).toHaveBeenCalledWith({
      where: { escrowId: 'escrow-1' },
    });
  });
});
