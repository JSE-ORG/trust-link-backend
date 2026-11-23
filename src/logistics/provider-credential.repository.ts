import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProviderCredentialRepository {
  constructor(
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  /**
   * Finds stored credential record for the specified provider.
   *
   * @param provider Provider name.
   * @returns Stored provider credential record or null if not found.
   */
  findByProvider(provider: string) {
    return (
      this.prisma?.providerCredential.findUnique({
        where: { provider },
      }) ?? Promise.resolve(null)
    );
  }

  /**
   * Persists or updates the encrypted API key for the given provider.
   *
   * @param provider Provider name.
   * @param encryptedKey Encrypted API key string.
   */
  async upsert(provider: string, encryptedKey: string): Promise<void> {
    await this.prisma?.providerCredential.upsert({
      where: { provider },
      update: { encryptedKey },
      create: { provider, encryptedKey },
    });
  }
}
