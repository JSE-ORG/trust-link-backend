import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/auth-user';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AnalyticsService } from './analytics.service';
import { ChartDataResponse } from './analytics.dto';
import { AnalyticsStatsResponse } from './analytics-stats.dto';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';

@ApiTags('Vendor')
@ApiBearerAuth()
@Controller('vendor/analytics')
@UseGuards(JwtGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

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
  @ApiOkResponse({
    description: 'Vendor transaction statistics returned.',
    type: AnalyticsStatsResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
  @Get()
  @HttpCode(HttpStatus.OK)
  async getTransactionStats(
    @CurrentUser() user?: AuthUser,
  ): Promise<AnalyticsStatsResponse> {
    return this.analyticsService.getTransactionStats(user!.address);
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
  @ApiOkResponse({
    description: 'Daily volume chart data returned.',
    type: ChartDataResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error.',
    type: ErrorResponseDto,
  })
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

    return this.analyticsService.getDailyVolumeChart(
      user!.address,
      days,
      timezone,
    );
  }
}
