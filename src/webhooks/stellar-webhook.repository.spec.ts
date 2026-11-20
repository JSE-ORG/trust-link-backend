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

    await expect(repository.markProcessed('op-2')).resolves.toBe(true);
    await repository.unmarkProcessed('op-2');

    expect(create).toHaveBeenCalledWith({ data: { operationId: 'op-2' } });
    expect(remove).toHaveBeenCalledWith({ where: { operationId: 'op-2' } });
  });

  it('treats a unique operation id conflict as an already processed event', async () => {
    const create = prisma.processedWebhookEvent.create as jest.Mock;
    create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(repository.markProcessed('op-racing')).resolves.toBe(false);
  });

  it('rethrows database errors other than a unique conflict', async () => {
    const create = prisma.processedWebhookEvent.create as jest.Mock;
    const databaseError = new Error('database unavailable');
    create.mockRejectedValueOnce(databaseError);

    await expect(repository.markProcessed('op-db-error')).rejects.toBe(
      databaseError,
    );
  });
});
