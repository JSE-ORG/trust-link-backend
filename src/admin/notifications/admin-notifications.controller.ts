import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../../common/security/throttle.config';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { NotificationRepository } from '../../notifications/notification.repository';
import { AdminNotificationsQueryDto } from './dto/admin-notifications-query.dto';
import { AdminNotificationsPaginatedResponseDto } from './dto/admin-notification-response.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class AdminNotificationsController {
  constructor(private readonly notificationRepo: NotificationRepository) {}

  /**
   * Retrieves paginated notification records for admin inspection and auditing.
   *
   * @param query Admin notification query filters and pagination parameters.
   * @returns Paginated notification envelopes matching criteria.
   * @throws UnauthorizedException if authentication token is missing or invalid.
   * @throws ForbiddenException if caller is not an admin.
   */
  @ApiOperation({ summary: 'List notifications for admin inspection' })
  @ApiResponse({
    status: 200,
    description: 'Paginated notifications returned.',
    type: AdminNotificationsPaginatedResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('notifications')
  getNotifications(@Query() query: AdminNotificationsQueryDto) {
    return this.notificationRepo.findAdminNotifications(query);
  }
}
