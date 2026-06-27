import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateVendorProfileDto } from './dto/create-vendor-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { VendorProfileService } from './vendor-profile.service';

@ApiTags('Vendor')
@ApiBearerAuth()
@Controller('vendor/profile')
@UseGuards(JwtGuard)
export class VendorProfileController {
  constructor(private readonly vendorProfileService: VendorProfileService) {}

  /**
   * Creates a new vendor profile for the authenticated user.
   *
   * @param dto - Profile details including business name and optional contact info
   * @param user - Authenticated vendor
   * @returns Created vendor profile
   * @throws BadRequestException if business name is invalid
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({ summary: 'Create vendor profile' })
  @ApiResponse({ status: 201, description: 'Vendor profile created.' })
  @ApiResponse({ status: 400, description: 'Invalid profile data.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateVendorProfileDto, @CurrentUser() user: AuthUser) {
    return this.vendorProfileService.createProfile(user.address, dto);
  }

  /**
   * Returns the vendor profile for the authenticated user.
   *
   * @param user - Authenticated vendor
   * @returns Vendor profile record
   * @throws NotFoundException if profile does not exist
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({ summary: 'Get current vendor profile' })
  @ApiResponse({ status: 200, description: 'Vendor profile returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.vendorProfileService.getProfile(user.address);
  }

  /**
   * Creates or replaces the vendor profile for the authenticated user.
   * If a profile already exists it is fully replaced.
   *
   * @param dto - Full profile details
   * @param user - Authenticated vendor
   * @returns Upserted vendor profile
   * @throws BadRequestException if profile data is invalid
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({ summary: 'Create or replace vendor profile' })
  @ApiResponse({ status: 200, description: 'Vendor profile upserted.' })
  @ApiResponse({ status: 400, description: 'Invalid profile data.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Put()
  @HttpCode(HttpStatus.OK)
  upsert(@Body() dto: CreateVendorProfileDto, @CurrentUser() user: AuthUser) {
    return this.vendorProfileService.upsertProfile(user.address, dto);
  }

  /**
   * Partially updates the vendor profile. Only provided fields are changed.
   *
   * @param dto - Partial profile update payload
   * @param user - Authenticated vendor
   * @returns Updated vendor profile
   * @throws BadRequestException if update data is invalid
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({ summary: 'Partially update vendor profile' })
  @ApiResponse({ status: 200, description: 'Vendor profile updated.' })
  @ApiResponse({ status: 400, description: 'Invalid update payload.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Patch()
  update(@Body() dto: UpdateVendorProfileDto, @CurrentUser() user: AuthUser) {
    return this.vendorProfileService.updateProfile(user.address, dto);
  }

  /**
   * Returns the notification preferences for the authenticated vendor.
   *
   * @param user - Authenticated vendor
   * @returns Current notification preferences
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({ summary: 'Get vendor notification preferences' })
  @ApiResponse({ status: 200, description: 'Notification preferences returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Get('notifications')
  getNotifications(@CurrentUser() user: AuthUser) {
    return this.vendorProfileService.getNotificationPreferences(user.address);
  }

  /**
   * Updates the notification preferences for the authenticated vendor.
   *
   * @param dto - Updated notification preferences
   * @param user - Authenticated vendor
   * @returns Updated notification preferences
   * @throws BadRequestException if preferences payload is invalid
   * @throws UnauthorizedException if Bearer token is missing or invalid
   * @authentication Requires valid SEP-10 JWT (vendor)
   */
  @ApiOperation({ summary: 'Update vendor notification preferences' })
  @ApiResponse({ status: 200, description: 'Notification preferences updated.' })
  @ApiResponse({ status: 400, description: 'Invalid preferences payload.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Patch('notifications')
  @HttpCode(HttpStatus.OK)
  updateNotifications(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vendorProfileService.updateNotificationPreferences(
      user.address,
      dto,
    );
  }
}
