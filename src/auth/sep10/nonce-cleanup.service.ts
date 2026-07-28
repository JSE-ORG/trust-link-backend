import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NonceCleanupService {
  private readonly logger = new Logger(NonceCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 0 * * *')
  async cleanupExpiredNonces(): Promise<void> {
    this.logger.log('Starting expired nonce cleanup');

    const now = new Date();

    const result = await this.prisma.nonce.deleteMany({
      where: {
        expiresAt: {
          lt: now,
        },
      },
    });

    this.logger.log(
      `Nonce cleanup completed: ${result.count} expired nonces deleted`,
    );
  }
}
