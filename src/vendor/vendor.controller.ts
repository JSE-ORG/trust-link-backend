import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import {
  CreateVendorProfileDto,
  UpdateNotificationPreferencesDto,
  UpdateVendorProfileDto,
} from './dto/vendor-profile.dto';
import { VendorService } from './vendor.service';

@Controller('vendor')
@UseGuards(JwtGuard)
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  // ── Profile CRUD ──────────────────────────────────────────────────────────

  @Post('profile')
  createProfile(
    @Body() dto: CreateVendorProfileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vendorService.createProfile(dto, user.address);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: AuthUser) {
    return this.vendorService.getProfile(user.address);
  }

  @Put('profile')
  replaceProfile(
    @Body() dto: CreateVendorProfileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vendorService.replaceProfile(dto, user.address);
  }

  @Patch('profile')
  patchProfile(
    @Body() dto: UpdateVendorProfileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vendorService.patchProfile(dto, user.address);
  }

  // ── Notification preferences ──────────────────────────────────────────────

  @Get('profile/notifications')
  getNotificationPreferences(@CurrentUser() user: AuthUser) {
    return this.vendorService.getNotificationPreferences(user.address);
  }

  @Patch('profile/notifications')
  patchNotificationPreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vendorService.patchNotificationPreferences(dto, user.address);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  @Get('analytics/chart')
  getAnalyticsChart(@CurrentUser() user: AuthUser) {
    return this.vendorService.getAnalyticsChart(user.address);
  }
}
