import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHmac, randomBytes } from 'crypto';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  WebAuth,
} from '@stellar/stellar-sdk';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MILLISECONDS_PER_SECOND } from '../../common/constants/time.constants';
import {
  CHALLENGE_TIMEOUT_SECONDS,
  JWT_EXPIRY_SECONDS,
  REFRESH_TOKEN_TTL_DEFAULT,
} from './sep10.constants';

@Injectable()
export class Sep10Service {
  private readonly logger = new Logger(Sep10Service.name);
  private readonly serverKeypair = Keypair.random();
  private readonly networkPassphrase: string;
  private readonly homeDomain = 'trust-link.local';
  private readonly webAuthDomain = 'trust-link.local';

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.networkPassphrase =
      this.configService.get('STELLAR_NETWORK') === 'MAINNET'
        ? Networks.PUBLIC
        : Networks.TESTNET;
  }

  /** Removes expired nonces from the database every 24 hours. */
  @Cron('0 0 * * *')
  async cleanupExpiredNonces(): Promise<void> {
    const now = new Date();
    const result = await this.prisma.nonce.deleteMany({
      where: {
        expiresAt: { lt: now },
      },
    });
    this.logger.log(`Cleaned up ${result.count} expired nonces`);
  }

  /** Builds and stores a SEP-10 challenge transaction for a wallet account. */
  async buildChallenge(
    accountId: string,
    timeout = CHALLENGE_TIMEOUT_SECONDS,
  ): Promise<string> {
    const challengeTx = WebAuth.buildChallengeTx(
      this.serverKeypair,
      accountId,
      this.homeDomain,
      timeout,
      this.networkPassphrase,
      this.webAuthDomain,
    );

    const tx = TransactionBuilder.fromXDR(challengeTx, this.networkPassphrase);
    const txHash = tx.hash().toString('hex');

    const expiresAt = new Date(Date.now() + timeout * MILLISECONDS_PER_SECOND);

    await this.prisma.nonce.create({
      data: {
        nonce: txHash,
        walletAddress: accountId,
        challenge: challengeTx,
        used: false,
        expiresAt,
      },
    });

    return challengeTx;
  }

  /** Verifies a signed SEP-10 challenge and issues access plus refresh tokens. */
  async verifyAndIssueToken(
    challengeTx: string,
  ): Promise<{ token: string; refreshToken: string }> {
    let clientAccountID: string;
    let txHash: string;

    try {
      const result = WebAuth.readChallengeTx(
        challengeTx,
        this.serverKeypair.publicKey(),
        this.networkPassphrase,
        this.homeDomain,
        this.webAuthDomain,
      );
      clientAccountID = result.clientAccountID;
      const tx = TransactionBuilder.fromXDR(
        challengeTx,
        this.networkPassphrase,
      );
      txHash = tx.hash().toString('hex');
    } catch (err: unknown) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Invalid challenge',
      );
    }

    const nonceRecord = await this.prisma.nonce.findUnique({
      where: { nonce: txHash },
    });

    if (!nonceRecord) {
      throw new UnauthorizedException('Challenge not found');
    }
    if (nonceRecord.used) {
      throw new UnauthorizedException('Challenge has already been used');
    }
    if (new Date() > nonceRecord.expiresAt) {
      throw new UnauthorizedException('Challenge expired');
    }

    try {
      WebAuth.verifyChallengeTxSigners(
        challengeTx,
        this.serverKeypair.publicKey(),
        this.networkPassphrase,
        [clientAccountID],
        this.homeDomain,
        this.webAuthDomain,
      );
    } catch (err: unknown) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Invalid client signature',
      );
    }

    await this.prisma.nonce.update({
      where: { id: nonceRecord.id },
      data: { used: true },
    });

    return this.generateAuthTokens(clientAccountID);
  }

  /** Rotates a refresh token and revokes reused or expired token families. */
  async rotateRefreshToken(
    oldToken: string,
  ): Promise<{ token: string; refreshToken: string }> {
    const tokenHash = this.hashToken(oldToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.revoked) {
      this.logger.warn(
        `Reuse of revoked refresh token detected for user ${storedToken.userId}`,
      );
      await this.revokeTokenFamily(storedToken.id);
      throw new UnauthorizedException(
        'Refresh token reuse detected. All sessions revoked.',
      );
    }

    if (new Date() > storedToken.expiresAt) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke the old token
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    return this.generateAuthTokens(storedToken.userId, storedToken.id);
  }

  /** Revokes every refresh token associated with the selected token family owner. */
  async revokeTokenFamily(tokenId: string): Promise<void> {
    // Revoke all tokens in this family by matching parentTokenId transitively
    // For simplicity, we can revoke all tokens for this user, or just revoke by parent chain.
    // The issue implies revoking the entire token family. Let's just revoke all tokens for the user to be safe and invalidate all active sessions.
    const token = await this.prisma.refreshToken.findUnique({
      where: { id: tokenId },
    });
    if (token) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: token.userId },
        data: { revoked: true },
      });
    }
  }

  private async generateAuthTokens(
    userId: string,
    parentTokenId?: string,
  ): Promise<{ token: string; refreshToken: string }> {
    const token = this.issueJwt(userId);

    const refreshToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(refreshToken);
    const ttlSeconds =
      this.configService.get<number>('REFRESH_TOKEN_TTL') ||
      REFRESH_TOKEN_TTL_DEFAULT;
    const expiresAt = new Date(
      Date.now() + ttlSeconds * MILLISECONDS_PER_SECOND,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        parentTokenId: parentTokenId ?? null,
        expiresAt,
        revoked: false,
      },
    });

    return { token, refreshToken };
  }

  private hashToken(token: string): string {
    return createHmac(
      'sha256',
      this.configService.get('SEP10_JWT_SECRET') || 'secret',
    )
      .update(token)
      .digest('hex');
  }

  /** Returns the public key used to sign SEP-10 challenge transactions. */
  getServerPublicKey(): string {
    return this.serverKeypair.publicKey();
  }

  /** Returns the active Stellar network passphrase for challenge verification. */
  getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  private issueJwt(sub: string): string {
    const now = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
    const adminAddress = this.configService.get('ADMIN_ADDRESS');
    const payload: {
      sub: string;
      iat: number;
      exp: number;
      role?: 'admin';
    } = { sub, iat: now, exp: now + JWT_EXPIRY_SECONDS };
    if (adminAddress && sub === adminAddress) {
      payload.role = 'admin';
    }
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac(
      'sha256',
      this.configService.get('SEP10_JWT_SECRET') || 'secret',
    )
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${sig}`;
  }
}
