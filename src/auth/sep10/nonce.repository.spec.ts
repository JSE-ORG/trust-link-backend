import { PrismaService } from '../../prisma/prisma.service';
import { NonceRepository } from './nonce.repository';

describe('NonceRepository', () => {
  const prisma = {
    nonce: { deleteMany: jest.fn() },
  } as unknown as PrismaService;
  const repository = new NonceRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('deletes only nonces that expired before the supplied time', async () => {
    const deleteMany = prisma.nonce.deleteMany as jest.Mock;
    deleteMany.mockResolvedValue({ count: 2 });
    const before = new Date('2026-09-27T00:00:00.000Z');

    await expect(repository.deleteExpired(before)).resolves.toEqual({
      count: 2,
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: before } },
    });
  });
});
