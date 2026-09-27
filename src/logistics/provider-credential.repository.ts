import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProviderCredentialRepository {
  constructor(
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  findByProvider(provider: string) {
    return (
      this.prisma?.providerCredential.findUnique({
        where: { provider },
      }) ?? Promise.resolve(null)
    );
  }

  async upsert(provider: string, encryptedKey: string): Promise<void> {
    await this.prisma?.providerCredential.upsert({
      where: { provider },
      update: { encryptedKey },
      create: { provider, encryptedKey },
    });
  }
}
