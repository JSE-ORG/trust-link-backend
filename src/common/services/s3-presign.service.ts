import { createHmac, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';

const PRESIGN_TTL_MS = 3600_000; // 1 hour

@Injectable()
export class S3PresignService {
  private readonly secret = randomBytes(32).toString('hex');

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
   * Every URL is signed against the same per-instance secret with the same
   * 1-hour expiry computed at call time, so all returned URLs in one call
   * expire together. An empty input yields an empty array. Like `presign`
   * this is the simulated scheme — the signing key is a random value
   * generated at construction and is not shared across replicas, so a URL
   * signed by one instance will not verify against another.
   */
  presignAll(urls: string[]): string[] {
    return urls.map((u) => this.presign(u));
  }
}
