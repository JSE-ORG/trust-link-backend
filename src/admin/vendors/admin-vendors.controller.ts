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
import { VendorProfileRepository } from '../../vendor/vendor-profile.repository';
import { AdminVendorsQueryDto } from './dto/admin-vendors-query.dto';
import { AdminVendorsPaginatedResponseDto } from './dto/admin-vendors-response.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/vendors')
@UseGuards(JwtGuard, AdminGuard)
export class AdminVendorsController {
  constructor(
    private readonly vendorProfileRepository: VendorProfileRepository,
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
}
