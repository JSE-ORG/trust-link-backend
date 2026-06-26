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
   * Tries to extract authenticated user context from the token:
   * 1. If the token looks like a JWT (3 base64url segments), verify the
   *    HMAC-SHA256 signature before trusting the sub and optional role claims.
   * 2. Otherwise treat the whole token as a raw address (legacy / test path).
   */
  private extractUser(token: string): AuthUser | null {
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const [header, body, signature] = parts;
        const expected = createHmac('sha256', this.getJwtSecret())
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
        ) as { role?: unknown; sub?: string };
        if (typeof payload.sub === 'string' && payload.sub) {
          return {
            address: payload.sub,
            role: typeof payload.role === 'string' ? payload.role : undefined,
          };
        }
      } catch {
        // not a valid JWT payload — fall through
      }
    }
    return token ? { address: token } : null;
  }

  private getJwtSecret(): string {
    return (
      this.configService?.get<string>('SEP10_JWT_SECRET') ??
      process.env.SEP10_JWT_SECRET ??
      'secret'
    );
  }
}
