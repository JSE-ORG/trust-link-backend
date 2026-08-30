import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';

const PRESIGN_TTL_MS = 3600_000; // 1 hour

/**
 * Simulated S3 pre-signing.
 *
 * Returns pre-signed URLs valid for 1 hour signed with an HMAC-SHA256 key
 * derived from `PRESIGN_SECRET`. The secret is read from configuration — never
 * generated at construction — so signed URLs are reproducible across restarts
 * and identical across replicas, which is what makes the signature usable as a
 * verification mechanism.
 *
 * In production this would delegate to AWS SDK's `getSignedUrl`; real S3
 * integration is intentionally out of scope.
 */
@Injectable()
export class S3PresignService {
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('PRESIGN_SECRET');
    if (!secret) {
      throw new Error(
        'PRESIGN_SECRET is not configured. Refusing to sign presigned URLs ' +
          'with a generated key, which would invalidate every in-flight URL on ' +
          'restart. Set PRESIGN_SECRET in your environment.',
      );
    }
    this.secret = secret;
  }

  /**
   * Returns a simulated pre-signed URL valid for 1 hour.
   * In production this would delegate to AWS SDK's getSignedUrl.
   */
  presign(url: string): string {
    const expiresAt = Date.now() + PRESIGN_TTL_MS;
    const sig = createHmac('sha256', this.secret)
      .update(`${url}:${expiresAt}`)
      .digest('hex')
      .slice(0, 16);
    return `${url}?X-Expires=${expiresAt}&X-Signature=${sig}`;
  }

  /**
   * Pre-signs each URL in `urls` via {@link presign}, preserving order.
   *
   * Every URL is signed against the same configured secret with the same
   * 1-hour expiry computed at call time, so all returned URLs in one call
   * expire together. An empty input yields an empty array.
   */
  presignAll(urls: string[]): string[] {
    return urls.map((u) => this.presign(u));
  }
}
