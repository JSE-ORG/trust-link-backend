import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NonceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deletes expired nonces older than the specified date.
   *
   * @param before Expiration cutoff date.
   * @returns Prisma batch payload indicating count of deleted rows.
   */
  deleteExpired(before: Date) {
    return this.prisma.nonce.deleteMany({
      where: { expiresAt: { lt: before } },
    });
  }
}
