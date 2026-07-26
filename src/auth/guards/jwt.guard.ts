import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConfigService } from '../../config/config.service';
import { AuthUser } from '../auth-user';

interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authorization = request.headers.authorization;
    const header = Array.isArray(authorization)
      ? authorization[0]
      : authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = this.extractUser(token);
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    request.user = user;
    return true;
  }

  /**
   * Extracts authenticated user context from a signed SEP-10 access token.
   *
   * The token must be three base64url segments with a verifiable HMAC-SHA256
   * signature and an unexpired `exp` claim. Anything else returns null and the
   * caller is rejected.
   *
   * This function previously fell back to treating an unverifiable token as a
   * raw Stellar address, which let any caller authenticate as any account by
   * sending that account's public key as a bearer token. Do not reintroduce a
   * fallback path here. Tests authenticate with `test/auth-helper.ts`, which
   * issues genuinely signed tokens.
   */
  private extractUser(token: string): AuthUser | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const secret = this.getJwtSecret();
    if (!secret) {
      // Fail closed. A missing secret must never downgrade to accepting
      // unverified tokens.
      return null;
    }

    try {
      const [header, body, signature] = parts;
      const expected = createHmac('sha256', secret)
        .update(`${header}.${body}`)
        .digest('base64url');
      const signatureBuffer = Buffer.from(signature, 'base64url');
      const expectedBuffer = Buffer.from(expected, 'base64url');
      if (
        signatureBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(signatureBuffer, expectedBuffer)
      ) {
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as { role?: unknown; sub?: unknown; exp?: unknown };

      if (typeof payload.exp === 'number') {
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (payload.exp <= nowSeconds) {
          return null;
        }
      }

      if (typeof payload.sub !== 'string' || !payload.sub) {
        return null;
      }

      // Role is carried through as signed. It is not an authorisation
      // decision: AdminGuard decides what 'admin' grants, and only
      // Sep10Service.issueJwt can mint a token claiming it.
      return {
        address: payload.sub,
        role: typeof payload.role === 'string' ? payload.role : undefined,
      };
    } catch {
      // Malformed base64url or payload JSON. Reject rather than fall through.
      return null;
    }
  }

  /**
   * Returns the configured signing secret, or undefined when none is set.
   *
   * There is deliberately no default. `SEP10_JWT_SECRET` is declared
   * `Joi.string().min(32).required()` in `config.module.ts`, so a correctly
   * booted process always has one. A literal fallback here would mean a
   * partially wired process silently accepts tokens signed with a public
   * constant.
   */
  private getJwtSecret(): string | undefined {
    return (
      this.configService?.get<string>('SEP10_JWT_SECRET') ??
      process.env.SEP10_JWT_SECRET
    );
  }
}
