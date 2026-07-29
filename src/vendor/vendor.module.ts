import { Module } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { VendorProfileController } from './vendor-profile.controller';
import { VendorProfileRepository } from './vendor-profile.repository';
import { VendorProfileService } from './vendor-profile.service';
import { VendorAccountDetailsController } from './vendor-account-details.controller';
import { VendorAccountDetailsRepository } from './vendor-account-details.repository';
import { VendorAccountDetailsService } from './vendor-account-details.service';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [PrismaModule, AnalyticsModule],
  controllers: [VendorProfileController, VendorAccountDetailsController],
  providers: [
    VendorProfileService,
    VendorProfileRepository,
    VendorAccountDetailsService,
    VendorAccountDetailsRepository,
    JwtGuard,
  ],
  exports: [VendorProfileService, VendorAccountDetailsService],
})
export class VendorModule {}
