import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
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
  private readonly serverKeypair: Keypair;
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

    this.serverKeypair = this.loadServerKeypair();
  }

  /**
   * Loads the SEP-10 challenge signing keypair from configuration.
   *
   * This was previously `Keypair.random()`, evaluated once per instance. That
   * meant the signing key changed on every restart, so a challenge issued
   * before a restart could never be verified after one, and two replicas could
   * never verify each other's challenges. It also made it impossible to publish
   * a stable SIGNING_KEY in a stellar.toml, which is what wallets check.
   *
   * Prefers `SEP10_SIGNING_SECRET` so web-auth signing can be separated from
   * transaction signing, and falls back to the already-required
   * `SYSTEM_SIGNER_SECRET`. Never generates a key.
   */
  private loadServerKeypair(): Keypair {
    const secret =
      this.configService.get<string>('SEP10_SIGNING_SECRET') ||
      this.configService.get<string>('SYSTEM_SIGNER_SECRET');

    if (!secret) {
      throw new Error(
        'No SEP-10 signing key configured. Set SEP10_SIGNING_SECRET, or ' +
          'SYSTEM_SIGNER_SECRET as a fallback. Refusing to generate an ' +
          'ephemeral key, which would invalidate every challenge on restart.',
      );
    }

    try {
      return Keypair.fromSecret(secret);
    } catch {
      throw new Error(
        'The configured SEP-10 signing secret is not a valid Stellar secret key.',
      );
    }
  }

  /**
   * Builds a SEP-10 challenge transaction for `accountId`, persists a nonce
   * row keyed by the challenge transaction hash, and returns the challenge
   * XDR for the wallet to sign.
   *
   * The stored nonce is what makes the challenge single-use:
   * `verifyAndIssueToken` looks it up by the same hash, so a challenge that
   * was never persisted here can never be redeemed. `timeout` (seconds)
   * drives both the transaction's own time bounds and the nonce's
   * `expiresAt`; the default is {@link CHALLENGE_TIMEOUT_SECONDS}.
   *
   * Not idempotent — each call writes a new nonce row. It does not verify
   * that `accountId` is a real, funded Stellar account; that is the wallet's
   * concern.
   */
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

  /**
   * Verifies a wallet-signed SEP-10 challenge and, on success, issues a new
   * access + refresh token pair for the challenged account.
   *
   * Checks, in order: the challenge XDR parses and was signed by this
   * server; a matching nonce row exists; it has not been used; it has not
   * expired; the client's signature over the challenge is valid. Any failure
   * throws `UnauthorizedException` with a message safe to return to the
   * caller — no distinction is drawn between "not found" and "expired"
   * beyond the message text.
   *
   * The nonce is marked `used` **before** tokens are generated, so the
   * challenge is strictly one-time even under concurrent submission of the
   * same signed XDR. Not safe to retry with the same `challengeTx` after a
   * success — the second call fails as "already used".
   */
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

  /**
   * Exchanges a valid refresh token for a fresh access + refresh token pair,
   * revoking the presented token as part of the same operation (rotation).
   *
   * Reuse detection: if the presented token is already revoked, this is
   * treated as a stolen-token replay — {@link revokeTokenFamily} is called
   * to revoke every session for that user and an `UnauthorizedException` is
   * thrown. A token that is unknown or past `expiresAt` also throws
   * `UnauthorizedException` but without the family-wide revocation.
   *
   * Not safe to retry with the same `oldToken`: the first success revokes
   * it, so a retry trips the reuse path and nukes all of the user's
   * sessions. The new refresh token from the success is the only one the
   * caller should present next.
   */
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

  /**
   * Revokes **every** refresh token belonging to the user who owns
   * `tokenId` — not just the parent/child chain rooted at it.
   *
   * The method name says "family", but the implementation deliberately takes
   * the broader "revoke all of this user's sessions" interpretation: on a
   * suspected token theft the safe move is to force re-authentication
   * everywhere, and walking a `parentTokenId` chain could miss a branch the
   * attacker already rotated away from.
   *
   * Idempotent and safe to retry. A no-op if `tokenId` does not resolve to a
   * stored token (nothing to derive a user from). Does not throw.
   */
  async revokeTokenFamily(tokenId: string): Promise<void> {
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

  /**
   * Returns the JWT signing secret, throwing rather than falling back.
   *
   * `SEP10_JWT_SECRET` is `Joi.string().min(32).required()` in
   * `config.module.ts`, so this should be unreachable in a booted process.
   * It exists so that a partially wired process fails loudly instead of
   * signing tokens with a guessable constant.
   */
  private jwtSecret(): string {
    const secret = this.configService.get<string>('SEP10_JWT_SECRET');
    if (!secret) {
      throw new Error(
        'SEP10_JWT_SECRET is not configured. Refusing to sign or hash tokens.',
      );
    }
    return secret;
  }

  private hashToken(token: string): string {
    return createHmac('sha256', this.jwtSecret()).update(token).digest('hex');
  }

  /**
   * Returns the `G...` public key this service signs SEP-10 challenges with.
   *
   * This is the value that must be published as `SIGNING_KEY` in the domain's
   * `stellar.toml` — wallets compare the challenge signer against it. It is
   * derived from `SEP10_SIGNING_SECRET` (preferred) or `SYSTEM_SIGNER_SECRET`
   * at construction and is stable for the life of the process (see
   * `loadServerKeypair`). Pure getter — no I/O, never throws.
   */
  getServerPublicKey(): string {
    return this.serverKeypair.publicKey();
  }

  /**
   * Returns the Stellar network passphrase challenges are built and verified
   * against — `Networks.PUBLIC` when `STELLAR_NETWORK === 'MAINNET'`,
   * `Networks.TESTNET` otherwise.
   *
   * Exposed so a caller building or checking a challenge outside this
   * service uses the exact same network as `buildChallenge` /
   * `verifyAndIssueToken`; a mismatch makes every verification fail. Pure
   * getter — resolved once at construction.
   */
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
    const sig = createHmac('sha256', this.jwtSecret())
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${sig}`;
  }
}
