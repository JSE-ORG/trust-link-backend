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
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsDto } from './dto/admin-stats.dto';
import { AdminChartQueryDto } from './dto/admin-chart-query.dto';
import { AdminStatsChartBucketDto } from './dto/admin-stats-chart-bucket.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/stats')
@UseGuards(JwtGuard, AdminGuard)
export class AdminStatsController {
  constructor(private readonly adminStatsService: AdminStatsService) {}

  /**
   * Retrieves daily aggregated platform volume and escrow status metrics for charting.
   *
   * @param query Query containing days timeframe to query.
   * @returns Array of daily stats buckets.
   * @throws BadRequestException if days parameter fails validation.
   * @throws UnauthorizedException if authentication token is missing or invalid.
   * @throws ForbiddenException if caller is not an admin.
   */
  @ApiOperation({ summary: 'Get daily platform stats chart (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Daily aggregated platform stats returned.',
    type: [AdminStatsChartBucketDto],
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('chart')
  getChart(@Query() query: AdminChartQueryDto) {
    return this.adminStatsService.getChart(query?.days);
  }

  /**
   * Retrieves overall platform statistics including volume, escrow states, and disputes.
   *
   * @returns Aggregated platform statistics.
   * @throws UnauthorizedException if authentication token is missing or invalid.
   * @throws ForbiddenException if caller is not an admin.
   */
  @ApiOperation({ summary: 'Get platform-wide statistics (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Aggregated platform stats returned.',
    type: AdminStatsDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get()
  getStats() {
    return this.adminStatsService.getStats();
  }
}
