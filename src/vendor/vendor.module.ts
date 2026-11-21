import { forwardRef, Module } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationRepository } from '../notifications/notification.repository';
import { VendorProfileController } from './vendor-profile.controller';
import { VendorNotificationsController } from './vendor-notifications.controller';
import { VendorProfileRepository } from './vendor-profile.repository';
import { VendorProfileService } from './vendor-profile.service';
import { VendorAccountDetailsController } from './vendor-account-details.controller';
import { VendorAccountDetailsRepository } from './vendor-account-details.repository';
import { VendorAccountDetailsService } from './vendor-account-details.service';
import { AnalyticsModule } from './analytics/analytics.module';
import { PublicVendorController } from './public-vendor.controller';
import { EscrowModule } from '../escrow/escrow.module';

@Module({
  imports: [PrismaModule, AnalyticsModule],
  controllers: [
    VendorProfileController,
    VendorNotificationsController,
    VendorAccountDetailsController,
  ],
  providers: [
    VendorProfileService,
    VendorProfileRepository,
    VendorAccountDetailsService,
    VendorAccountDetailsRepository,
    NotificationRepository,
    JwtGuard,
  ],
  exports: [
    VendorProfileService,
    VendorProfileRepository,
    VendorAccountDetailsService,
  ],
})
export class VendorModule {}
