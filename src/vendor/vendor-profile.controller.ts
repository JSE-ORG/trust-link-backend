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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { CreateVendorProfileDto } from './dto/create-vendor-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { VendorProfileService } from './vendor-profile.service';

@Controller('vendor/profile')
@UseGuards(JwtGuard)
export class VendorProfileController {
  constructor(private readonly vendorProfileService: VendorProfileService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateVendorProfileDto, @CurrentUser() user: AuthUser) {
    return this.vendorProfileService.createProfile(user.address, dto);
  }

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.vendorProfileService.getProfile(user.address);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  upsert(@Body() dto: CreateVendorProfileDto, @CurrentUser() user: AuthUser) {
    return this.vendorProfileService.upsertProfile(user.address, dto);
  }

  @Patch()
  update(@Body() dto: UpdateVendorProfileDto, @CurrentUser() user: AuthUser) {
    return this.vendorProfileService.updateProfile(user.address, dto);
  }

  @Get('notifications')
  getNotifications(@CurrentUser() user: AuthUser) {
    return this.vendorProfileService.getNotificationPreferences(user.address);
  }

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
