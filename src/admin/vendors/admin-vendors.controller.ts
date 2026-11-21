import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
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
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { VendorProfileRepository } from '../../vendor/vendor-profile.repository';
import { AdminVendorsQueryDto } from './dto/admin-vendors-query.dto';
import { AdminVendorsPaginatedResponseDto } from './dto/admin-vendors-response.dto';
import { AnalyticsService } from '../../vendor/analytics/analytics.service';
import { AnalyticsStatsResponse } from '../../vendor/analytics/analytics-stats.dto';
import { ChartDataResponse } from '../../vendor/analytics/analytics.dto';
import { ChartQueryDto } from '../../vendor/analytics/chart-query.dto';
import { VendorAccountDetailsRepository } from '../../vendor/vendor-account-details.repository';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/vendors')
@UseGuards(JwtGuard, AdminGuard)
export class AdminVendorsController {
  constructor(
    private readonly vendorProfileRepository: VendorProfileRepository,
    private readonly analyticsService: AnalyticsService,
    private readonly accountDetailsRepository: VendorAccountDetailsRepository,
  ) {}

  @ApiOperation({ summary: 'List vendors with escrow counts (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Paged list of vendors with aggregated escrow counts.',
    type: AdminVendorsPaginatedResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get()
  listVendors(
    @Query() query: AdminVendorsQueryDto,
  ): Promise<AdminVendorsPaginatedResponseDto> {
    return this.vendorProfileRepository.listVendorsForAdmin(query);
  }

  @ApiOperation({ summary: "Get a vendor's transaction analytics (admin only)" })
  @ApiResponse({
    status: 200,
    description: 'Vendor analytics returned.',
    type: AnalyticsStatsResponse,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Vendor not found.' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get(':address/analytics')
  async getVendorAnalytics(
    @Param('address') address: string,
  ): Promise<AnalyticsStatsResponse> {
    await this.requireVendor(address);
    return this.analyticsService.getTransactionStats(address);
  }

  @ApiOperation({ summary: "Get a vendor's analytics chart (admin only)" })
  @ApiResponse({
    status: 200,
    description: 'Vendor chart data returned.',
    type: ChartDataResponse,
  })
  @ApiResponse({ status: 400, description: 'Invalid chart query.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'Vendor not found.' })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiQuery({ name: 'timezone', required: false, example: 'UTC' })
  @ApiQuery({
    name: 'interval',
    required: false,
    enum: ['day', 'week', 'month'],
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-01-31' })
  @Throttle({ default: { limit: 20, ttl: THROTTLE_WINDOW_MS } })
  @Get(':address/analytics/chart')
  async getVendorAnalyticsChart(
    @Param('address') address: string,
    @Query() query: ChartQueryDto,
    @Query('days') rawDays?: string,
    @Query('timezone') rawTimezone?: string,
  ): Promise<ChartDataResponse> {
    await this.requireVendor(address);

    const hasRange = Boolean(query?.from || query?.to);
    if (hasRange) {
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

    let timezone = rawTimezone;
    if (!timezone) {
      const details =
        await this.accountDetailsRepository.findByVendorAddress(address);
      timezone = details?.timezone ?? query?.timezone ?? 'UTC';
    }

    return this.analyticsService.getDailyVolumeChart(
      address,
      query?.days ?? 30,
      timezone,
      query?.interval ?? 'day',
      hasRange ? { from: query!.from!, to: query!.to! } : undefined,
    );
  }

  private async requireVendor(address: string): Promise<void> {
    const vendor = await this.vendorProfileRepository.findByAddress(address);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }
  }
}
