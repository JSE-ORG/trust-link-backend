import { PrismaService } from '../prisma/prisma.service';
import { CursorRepository } from './cursor.repository';

describe('CursorRepository', () => {
  const prisma = {
    cursor: { findUnique: jest.fn(), upsert: jest.fn() },
  } as unknown as PrismaService;
  const repository = new CursorRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('reads a cursor by its primary key', async () => {
    const findUnique = prisma.cursor.findUnique as jest.Mock;
    findUnique.mockResolvedValue({
      id: 'stellar-listener',
      cursorValue: '123',
    });

    await expect(
      repository.findById('stellar-listener'),
    ).resolves.toMatchObject({
      cursorValue: '123',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'stellar-listener' },
    });
  });

  it('upserts cursor progress', async () => {
    const upsert = prisma.cursor.upsert as jest.Mock;
    upsert.mockResolvedValue({});

    await repository.upsert('stellar-listener', '456');

    expect(upsert).toHaveBeenCalledWith({
      where: { id: 'stellar-listener' },
      update: { cursorValue: '456' },
      create: { id: 'stellar-listener', cursorValue: '456' },
    });
  });
});
