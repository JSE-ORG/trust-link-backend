import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  WebAuth,
} from '@stellar/stellar-sdk';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class Sep10Service {
  /** Server-side signing keypair — rotated per process start. */
  private readonly serverKeypair = Keypair.random();
  private readonly networkPassphrase: string;
  private readonly homeDomain = 'trust-link.local';
  private readonly webAuthDomain = 'trust-link.local';

  constructor(private readonly configService: ConfigService) {
    this.networkPassphrase = this.configService.get('STELLAR_NETWORK') === 'MAINNET' 
      ? Networks.PUBLIC 
      : Networks.TESTNET;
  }
  /** Replay-prevention store: transaction hashes already consumed. */
  private readonly usedChallenges = new Set<string>();

  /** Returns a base64-encoded SEP-10 challenge XDR. */
  buildChallenge(accountId: string, timeout = 300): string {
    return WebAuth.buildChallengeTx(
      this.serverKeypair,
      accountId,
      this.homeDomain,
      timeout,
      this.networkPassphrase,
      this.webAuthDomain,
    );
  }

  /**
   * Validates a signed challenge and returns a JWT for the authenticated account.
   * Throws `UnauthorizedException` on any validation failure.
   */
  verifyAndIssueToken(challengeTx: string): string {
    let clientAccountID: string;
    let txHash: string;

    // 1. Read & validate challenge structure + server signature + time bounds
    try {
      const result = WebAuth.readChallengeTx(
        challengeTx,
        this.serverKeypair.publicKey(),
        this.networkPassphrase,
        this.homeDomain,
        this.webAuthDomain,
      );
      clientAccountID = result.clientAccountID;
      const tx = TransactionBuilder.fromXDR(challengeTx, this.networkPassphrase);
      txHash = tx.hash().toString('hex');
    } catch (err: unknown) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Invalid challenge',
      );
    }

    // 2. Replay protection
    if (this.usedChallenges.has(txHash)) {
      throw new UnauthorizedException('Challenge has already been used');
    }

    // 3. Verify client signature
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

    // 4. Mark challenge as consumed and issue JWT
    this.usedChallenges.add(txHash);
    return this.issueJwt(clientAccountID);
  }

  /** Expose the server public key for tests / stellar.toml. */
  getServerPublicKey(): string {
    return this.serverKeypair.publicKey();
  }

  // ── JWT helpers ──────────────────────────────────────────────────────────

  private issueJwt(sub: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub, iat: now, exp: now + 3600 };
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.configService.get('SEP10_JWT_SECRET'))
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${sig}`;
  }
}
