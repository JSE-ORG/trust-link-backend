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

  @ApiOperation({ summary: 'Create vendor profile' })
  @ApiResponse({ status: 201, description: 'Vendor profile created.' })
  @ApiResponse({ status: 400, description: 'Invalid profile data.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateVendorProfileDto, @CurrentUser() user: AuthUser) {
    return this.vendorProfileService.createProfile(user.address, dto);
  }

  @ApiOperation({ summary: 'Get current vendor profile' })
  @ApiResponse({ status: 200, description: 'Vendor profile returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.vendorProfileService.getProfile(user.address);
  }

  @ApiOperation({ summary: 'Create or replace vendor profile' })
  @ApiResponse({ status: 200, description: 'Vendor profile upserted.' })
  @ApiResponse({ status: 400, description: 'Invalid profile data.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Put()
  @HttpCode(HttpStatus.OK)
  upsert(@Body() dto: CreateVendorProfileDto, @CurrentUser() user: AuthUser) {
    return this.vendorProfileService.upsertProfile(user.address, dto);
  }

  @ApiOperation({ summary: 'Partially update vendor profile' })
  @ApiResponse({ status: 200, description: 'Vendor profile updated.' })
  @ApiResponse({ status: 400, description: 'Invalid update payload.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Patch()
  update(@Body() dto: UpdateVendorProfileDto, @CurrentUser() user: AuthUser) {
    return this.vendorProfileService.updateProfile(user.address, dto);
  }

  @ApiOperation({ summary: 'Get vendor notification preferences' })
  @ApiResponse({ status: 200, description: 'Notification preferences returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @Get('notifications')
  getNotifications(@CurrentUser() user: AuthUser) {
    return this.vendorProfileService.getNotificationPreferences(user.address);
  }

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
