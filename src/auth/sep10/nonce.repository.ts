import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NonceRepository {
  constructor(private readonly prisma: PrismaService) {}

  deleteExpired(before: Date) {
    return this.prisma.nonce.deleteMany({
      where: { expiresAt: { lt: before } },
    });
  }
}
