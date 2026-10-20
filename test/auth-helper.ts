import { createHmac } from 'crypto';

import { JWT_EXPIRY_SECONDS } from '../src/auth/sep10/sep10.constants';
import { MILLISECONDS_PER_SECOND } from '../src/common/constants/time.constants';

/**
 * Signs SEP-10 style access tokens for tests.
 *
 * `JwtGuard` verifies an HMAC-SHA256 signature and rejects anything it cannot
 * verify. Tests must therefore present a genuinely signed token rather than a
 * bare address. This helper produces one using the same algorithm and claim
 * shape as `Sep10Service.issueJwt`, so a test token is indistinguishable from
 * a real one to the guard.
 *
 * Keep this in step with `Sep10Service.issueJwt`. If the claim shape or
 * algorithm changes there, change it here in the same commit or every
 * authenticated test will start failing for the wrong reason.
 */

/**
 * Throwaway Stellar secret key for tests that construct `Sep10Service` with a
 * mocked `ConfigService`. Matches `SYSTEM_SIGNER_SECRET` in `.env.test`.
 *
 * Generated for test use only. It holds no funds and must never be used
 * anywhere real.
 */
export const TEST_SIGNING_SECRET =
  'SAIJDXETR5B7YFPH7SUOISWVBHHSI46JLYFDCWDMEV2L46XAHASPP35C';

/** Secret used to sign test tokens. Matches `SEP10_JWT_SECRET` in `.env.test`. */
function testSecret(): string {
  const secret = process.env.SEP10_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'SEP10_JWT_SECRET is not set. Jest must load .env.test via test/setup-env.ts ' +
        'before this helper can sign a token.',
    );
  }
  return secret;
}

export interface TestTokenOptions {
  /** Marks the token as an admin. Omit for an ordinary user. */
  role?: 'admin';
  /** Seconds until expiry. Pass a negative value to produce an expired token. */
  expiresInSeconds?: number;
  /** Sign with the wrong secret, to test rejection of forged tokens. */
  secret?: string;
}

/**
 * Returns a signed JWT for the given Stellar address.
 *
 * @param address Stellar public key the token authenticates as.
 */
export function signTestJwt(
  address: string,
  options: TestTokenOptions = {},
): string {
  const {
    role,
    expiresInSeconds = JWT_EXPIRY_SECONDS,
    secret = testSecret(),
  } = options;

  const now = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
  const payload: {
    sub: string;
    iat: number;
    exp: number;
    role?: 'admin';
  } = { sub: address, iat: now, exp: now + expiresInSeconds };

  if (role) {
    payload.role = role;
  }

  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

/** Returns a ready-to-use `Authorization` header value for the given address. */
export function bearer(address: string, options?: TestTokenOptions): string {
  return `Bearer ${signTestJwt(address, options)}`;
}
