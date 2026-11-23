import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RefreshTokenRepository } from './refresh-token.repository';
import { MILLISECONDS_PER_DAY } from '../../common/constants/time.constants';

/**
 * Daily job that purges expired SEP-10 refresh tokens (issue #961).
 *
 * Runs at midnight UTC (`0 0 * * *`) and is safe to invoke directly at any
 * time — idempotent, holds no cross-call state. It only removes rows that can
 * no longer be redeemed: `expiresAt` older than the grace period. Revoked but
 * unexpired rows stay, since reuse detection needs them to catch replays.
 */
@Injectable()
export class RefreshTokenCleanupService {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);

  /** 30 days, in milliseconds. Expired rows older than this are deleted. */
  private static readonly GRACE_PERIOD_MS = 30 * MILLISECONDS_PER_DAY;

  constructor(
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  /**
   * Purges expired refresh tokens that have exceeded the retention grace period.
   */
  @Cron('0 0 * * *')
  async cleanupExpiredRefreshTokens(): Promise<void> {
    this.logger.log('Starting expired refresh token cleanup');

    const cutoff = new Date(
      Date.now() - RefreshTokenCleanupService.GRACE_PERIOD_MS,
    );

    const result = await this.refreshTokenRepository.deleteExpired(cutoff);

    this.logger.log(
      `Refresh token cleanup completed: ${result.count} expired refresh tokens deleted`,
    );
  }
}
