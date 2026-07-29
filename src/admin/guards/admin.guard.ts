import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthUser } from '../../auth/auth-user';
import { ConfigService } from '../../config/config.service';

interface RequestWithUser {
  user?: AuthUser;
}

/**
 * Enforces admin authorization.
 *
 * Authorization is strictly based on the caller's wallet address matching the
 * configured `ADMIN_ADDRESS`. The `role: 'admin'` claim carried in the JWT is
 * informational (stamped by Sep10Service.issueJwt when the subject equals
 * ADMIN_ADDRESS) and is not authoritative for access control.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const adminAddress = this.configService.get<string>('ADMIN_ADDRESS');

    if (!request.user || !adminAddress || request.user.address !== adminAddress) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
