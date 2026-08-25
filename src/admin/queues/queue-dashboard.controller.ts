import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { QueueDashboardService } from './queue-dashboard.service';
import { QueuesDashboardDto } from './queue-stats.dto';

/**
 * Issue #75 – GET /admin/queues
 *
 * Returns real-time job counts for every registered BullMQ queue.
 * The endpoint is protected by JwtGuard + AdminGuard so only the configured
 * ADMIN_ADDRESS can access it.
 *
 * Example response:
 * {
 *   "queues": [
 *     {
 *       "name": "auto-release",
 *       "counts": { "waiting": 0, "active": 1, "completed": 42, "failed": 0, "delayed": 0, "paused": 0 },
 *       "isPaused": false
 *     }
 *   ],
 *   "generatedAt": "2026-05-27T10:00:00.000Z"
 * }
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/queues')
@UseGuards(JwtGuard, AdminGuard)
export class QueueDashboardController {
  constructor(private readonly dashboardService: QueueDashboardService) {}

  /**
   * Returns real-time job counts for all registered BullMQ queues.
   *
   * @returns Dashboard data with per-queue job counts and pause status
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @throws ForbiddenException if caller is not an admin
   * @authentication Requires valid SEP-10 JWT (admin only)
   */
  @ApiOperation({ summary: 'Get real-time BullMQ queue dashboard data' })
  @ApiResponse({ status: 200, description: 'Queue counts returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @Throttle({ auth: { limit: 20, ttl: 60000 } })
  @Get()
  getDashboard(): Promise<QueuesDashboardDto> {
    return this.dashboardService.getDashboard();
  }
}
