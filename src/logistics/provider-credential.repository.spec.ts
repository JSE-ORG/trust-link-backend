import { PrismaService } from '../prisma/prisma.service';
import { ProviderCredentialRepository } from './provider-credential.repository';

describe('ProviderCredentialRepository', () => {
  const prisma = {
    providerCredential: { findUnique: jest.fn(), upsert: jest.fn() },
  } as unknown as PrismaService;
  const repository = new ProviderCredentialRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('looks up credentials by provider', async () => {
    const findUnique = prisma.providerCredential.findUnique as jest.Mock;
    findUnique.mockResolvedValue({
      provider: 'logistics',
      encryptedKey: 'cipher',
    });

    await expect(repository.findByProvider('logistics')).resolves.toMatchObject(
      {
        encryptedKey: 'cipher',
      },
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { provider: 'logistics' },
    });
  });

  it('upserts the encrypted credential', async () => {
    const upsert = prisma.providerCredential.upsert as jest.Mock;
    upsert.mockResolvedValue({});

    await repository.upsert('logistics', 'cipher');

    expect(upsert).toHaveBeenCalledWith({
      where: { provider: 'logistics' },
      update: { encryptedKey: 'cipher' },
      create: { provider: 'logistics', encryptedKey: 'cipher' },
    });
  });
});
