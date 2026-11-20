import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Persisted store for SEP-10 refresh tokens (issue #961).
 *
 * Rotation and reuse detection only set `revoked`; nothing deletes expired
 * rows, so the table grows by at least one row per session per refresh,
 * forever. This repository adds the delete path used by
 * `RefreshTokenCleanupService`. Revoked-but-unexpired rows are deliberately
 * left in place because reuse detection needs them to catch replays; only
 * rows whose `expiresAt` has passed can be removed.
 */
@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deletes every refresh token whose `expiresAt` is strictly before `before`.
   * Revoked rows are included when expired — an expired token can never be
   * replayed, so keeping it serves no purpose. Unrevoked-but-expired rows are
   * also removed.
   */
  deleteExpired(before: Date) {
    return this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: before } },
    });
  }
}
