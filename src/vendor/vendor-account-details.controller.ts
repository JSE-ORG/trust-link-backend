import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { UpdateVendorAccountDetailsDto } from './dto/update-vendor-account-details.dto';
import { VendorAccountDetailsResponseDto } from './dto/vendor-account-details-response.dto';
import { VendorAccountDetailsService } from './vendor-account-details.service';

@ApiTags('Vendor')
@ApiBearerAuth()
@Controller('vendor/account-details')
@UseGuards(JwtGuard)
export class VendorAccountDetailsController {
  constructor(
    private readonly service: VendorAccountDetailsService,
  ) {}

  /**
   * Returns account details for the authenticated vendor.
   * Sensitive fields (bank account number, tax identifier) are masked.
   *
   * @param user - Authenticated vendor
   * @returns Vendor account details with masked sensitive fields
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({ summary: 'Get vendor account details' })
  @ApiResponse({
    status: 200,
    description: 'Vendor account details returned.',
    type: VendorAccountDetailsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const details = await this.service.getDetails(user.address);
    if (!details) {
      return null;
    }
    return VendorAccountDetailsResponseDto.fromRecord(details);
  }

  /**
   * Creates or updates account details for the authenticated vendor.
   * Sensitive fields (bank account number, tax identifier) are masked in response.
   *
   * @param dto - Account details to update
   * @param user - Authenticated vendor
   * @returns Updated vendor account details with masked sensitive fields
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({ summary: 'Update vendor account details' })
  @ApiResponse({
    status: 200,
    description: 'Vendor account details updated.',
    type: VendorAccountDetailsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Patch()
  async update(
    @Body() dto: UpdateVendorAccountDetailsDto,
    @CurrentUser() user: AuthUser,
  ) {
    const details = await this.service.upsertDetails(user.address, dto);
    return VendorAccountDetailsResponseDto.fromRecord(details);
  }
}
