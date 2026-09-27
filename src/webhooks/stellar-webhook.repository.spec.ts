import { PrismaService } from '../prisma/prisma.service';
import { StellarWebhookRepository } from './stellar-webhook.repository';

describe('StellarWebhookRepository', () => {
  const prisma = {
    processedWebhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  } as unknown as PrismaService;
  const repository = new StellarWebhookRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('checks whether an operation was processed', async () => {
    const findUnique = prisma.processedWebhookEvent.findUnique as jest.Mock;
    findUnique.mockResolvedValue({ operationId: 'op-1' });

    await expect(repository.isProcessed('op-1')).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { operationId: 'op-1' },
      select: { operationId: true },
    });
  });

  it('marks and unmarks an operation as processed', async () => {
    const create = prisma.processedWebhookEvent.create as jest.Mock;
    const remove = prisma.processedWebhookEvent.delete as jest.Mock;
    create.mockResolvedValue({});
    remove.mockResolvedValue({});

    await repository.markProcessed('op-2');
    await repository.unmarkProcessed('op-2');

    expect(create).toHaveBeenCalledWith({ data: { operationId: 'op-2' } });
    expect(remove).toHaveBeenCalledWith({ where: { operationId: 'op-2' } });
  });
});
