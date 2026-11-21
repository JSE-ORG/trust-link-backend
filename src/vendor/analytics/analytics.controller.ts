import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_WINDOW_MS } from '../../common/security/throttle.config';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/auth-user';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AnalyticsService } from './analytics.service';
import { ChartDataResponse } from './analytics.dto';
import { AnalyticsStatsResponse } from './analytics-stats.dto';
import { ChartQueryDto } from './chart-query.dto';
import { AnalyticsStatsQueryDto } from './analytics-stats-query.dto';
import { VendorAccountDetailsRepository } from '../vendor-account-details.repository';

@ApiTags('Vendor')
@ApiBearerAuth()
@Controller('vendor/analytics')
@UseGuards(JwtGuard)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    @Optional()
    private readonly accountDetailsRepo?: VendorAccountDetailsRepository,
  ) {}

  /**
   * Returns overall transaction statistics for the authenticated vendor.
   * Includes volume totals, conversion metrics, dispute rates, and
   * notification channel preferences.
   *
   * @param user - Authenticated vendor
   * @returns Transaction statistics and channel metrics
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({
    summary: 'Get overall transaction statistics for the authenticated vendor',
  })
  @ApiResponse({
    status: 200,
    description: 'Vendor transaction statistics returned.',
    type: AnalyticsStatsResponse,
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Inclusive createdAt lower bound (ISO 8601).',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Inclusive createdAt upper bound (ISO 8601).',
  })
  @ApiResponse({ status: 400, description: 'Invalid date range.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get()
  @HttpCode(HttpStatus.OK)
  async getTransactionStats(
    @CurrentUser() user?: AuthUser,
    @Query() query?: AnalyticsStatsQueryDto,
  ): Promise<AnalyticsStatsResponse> {
    // `CurrentUser` really can be undefined; assert-and-hope (`user!`) turned
    // a missing user into a 500 if `JwtGuard` were ever removed or reordered.
    // Fail as 401 instead (#671).
    if (!user) {
      throw new UnauthorizedException();
    }
    if (
      query?.from &&
      query?.to &&
      new Date(query.from).getTime() > new Date(query.to).getTime()
    ) {
      throw new BadRequestException('from must not be after to');
    }
    return this.analyticsService.getTransactionStats(user.address, query);
  }

  /**
   * Returns daily transaction volume data for chart rendering.
   *
   * @param daysParam - Number of days to retrieve (default 30, max 365)
   * @param timezoneParam - Timezone for date grouping (default UTC)
   * @param user - Authenticated vendor
   * @returns Daily volume data with summary totals
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({
    summary:
      'Get daily transaction volume chart data for the authenticated vendor',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: 'Number of days of data to retrieve (max 365).',
    example: 30,
  })
  @ApiQuery({
    name: 'timezone',
    required: false,
    description: 'IANA timezone for date grouping.',
    example: 'UTC',
  })
  @ApiQuery({
    name: 'interval',
    required: false,
    enum: ['day', 'week', 'month'],
    description: 'Aggregation interval (default: day).',
    example: 'day',
  })
  @ApiResponse({
    status: 200,
    description: 'Daily volume chart data returned.',
    type: ChartDataResponse,
  })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get('chart')
  @HttpCode(HttpStatus.OK)
  async getDailyVolumeChart(
    @Query() query?: ChartQueryDto,
    @CurrentUser() user?: AuthUser,
    @Query('days') rawDays?: string,
  ): Promise<ChartDataResponse> {
    if (!user) {
      throw new UnauthorizedException();
    }

    const hasRange = Boolean(query?.from || query?.to);
    if (hasRange) {
      // `query.days` always carries a value (defaults to 30), so presence is
      // checked against the raw query string instead.
      if (rawDays !== undefined) {
        throw new BadRequestException('from/to cannot be combined with days');
      }
      if (!query?.from || !query?.to) {
        throw new BadRequestException('from and to must both be provided');
      }
      if (query.from > query.to) {
        throw new BadRequestException('from must not be after to');
      }
      const spanDays =
        Math.round(
          (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000,
        ) + 1;
      if (spanDays > 366) {
        throw new BadRequestException('from/to must span at most 366 days');
      }
    }

    const days = query?.days ?? 30;
    const interval = query?.interval ?? 'day';

    let timezone = query?.timezone;
    if (!timezone && this.accountDetailsRepo) {
      const details = await this.accountDetailsRepo.findByVendorAddress(
        user.address,
      );
      if (details?.timezone) {
        timezone = details.timezone;
      }
    }
    if (!timezone) {
      timezone = 'UTC';
    }

    if (hasRange) {
      return this.analyticsService.getDailyVolumeChart(
        user.address,
        days,
        timezone,
        interval,
        { from: query!.from!, to: query!.to! },
      );
    }
    return this.analyticsService.getDailyVolumeChart(
      user.address,
      days,
      timezone,
      interval,
    );
  }
}
