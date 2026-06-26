import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/auth-user';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AnalyticsService } from './analytics.service';
import { ChartDataResponse } from './analytics.dto';
import { AnalyticsStatsResponse } from './analytics-stats.dto';

@Controller('vendor/analytics')
@UseGuards(JwtGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /vendor/analytics
   * Returns overall transaction statistics for the authenticated vendor.
   * Includes volumes, conversion metrics, and channel preferences.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getTransactionStats(
    @CurrentUser() user?: AuthUser,
  ): Promise<AnalyticsStatsResponse> {
    return this.analyticsService.getTransactionStats(user!.address);
  }

  /**
   * GET /vendor/analytics/chart
   * Returns daily transaction volume data for the authenticated vendor.
   * Query Parameters:
   *   - days: number of days to retrieve (default: 30, max: 365)
   *   - timezone: timezone for date grouping (default: UTC)
   */
  @Get('chart')
  @HttpCode(HttpStatus.OK)
  async getDailyVolumeChart(
    @Query('days') daysParam?: string,
    @Query('timezone') timezoneParam?: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<ChartDataResponse> {
    let days = 30;
    let timezone = 'UTC';

    if (daysParam) {
      const parsed = parseInt(daysParam, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 365) {
        days = parsed;
      }
    }

    if (timezoneParam) {
      timezone = timezoneParam;
    }

    return this.analyticsService.getDailyVolumeChart(user!.address, days, timezone);
  }
}
