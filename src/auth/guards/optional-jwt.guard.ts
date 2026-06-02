import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthUser } from '../auth-user';
import { JwtGuard } from './jwt.guard';

interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

/**
 * Like JwtGuard but never throws — if the token is absent or invalid the
 * request proceeds with req.user = undefined.  Use on endpoints that return
 * richer data to authenticated callers but are also open to anonymous access.
 */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  private readonly inner = new JwtGuard();

  canActivate(context: ExecutionContext): boolean {
    try {
      return this.inner.canActivate(context);
    } catch {
      const req = context
        .switchToHttp()
        .getRequest<RequestWithUser>();
      req.user = undefined;
      return true;
    }
  }
}
