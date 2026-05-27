import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthUser } from '../auth-user';

interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

@Injectable()
export class JwtGuard implements CanActivate {
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

    const address = this.extractAddress(token);
    if (!address) {
      throw new UnauthorizedException('Authentication required');
    }

    request.user = { address };
    return true;
  }

  /**
   * Tries to extract the Stellar address from the token:
   * 1. If the token looks like a JWT (3 base64url segments), decode the payload
   *    and return the `sub` claim.
   * 2. Otherwise treat the whole token as a raw address (legacy / test path).
   */
  private extractAddress(token: string): string | null {
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64url').toString('utf8'),
        ) as { sub?: string };
        if (typeof payload.sub === 'string' && payload.sub) {
          return payload.sub;
        }
      } catch {
        // not a valid JWT payload — fall through
      }
    }
    return token || null;
  }
}
