import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NonceCleanupService {
  private readonly logger = new Logger(NonceCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deletes every SEP-10 challenge nonce whose `expiresAt` is in the past.
   *
   * Runs on a daily cron (`0 0 * * *`) but is safe to invoke directly at any
   * time — it is idempotent and holds no cross-call state. It only removes
   * rows that can no longer be redeemed: `Sep10Service.verifyAndIssueToken`
   * already rejects an expired nonce before this ever deletes it, so a
   * concurrent verify is never affected. Unexpired nonces, used or not, are
   * left untouched (a used-but-unexpired nonce still needs to exist so a
   * replay is caught as "already used" rather than "not found").
   *
   * Does not throw on an empty result; a Prisma failure propagates to the
   * scheduler, which logs it.
   */
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
