import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../common/security/throttle.config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { VendorNotificationsQueryDto } from './dto/vendor-notifications-query.dto';
import { VendorNotificationHistoryPaginatedResponseDto } from './dto/vendor-notification-history-response.dto';
import { VendorProfileService } from './vendor-profile.service';

@ApiTags('Vendor')
@ApiBearerAuth()
@Controller('vendor/notifications')
@UseGuards(JwtGuard)
export class VendorNotificationsController {
  constructor(private readonly vendorProfileService: VendorProfileService) {}

  @ApiOperation({ summary: 'Get vendor notification history' })
  @ApiResponse({
    status: 200,
    description: 'Paginated notification history for the authenticated vendor.',
    type: VendorNotificationHistoryPaginatedResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('history')
  getHistory(
    @CurrentUser() user: AuthUser,
    @Query() query: VendorNotificationsQueryDto,
  ) {
    return this.vendorProfileService.getNotificationHistory(
      user.address,
      query,
    );
  }
}
