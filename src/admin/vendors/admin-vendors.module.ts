import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { VendorProfileRepository } from '../../vendor/vendor-profile.repository';
import { AnalyticsModule } from '../../vendor/analytics/analytics.module';
import { AdminVendorsController } from './admin-vendors.controller';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';

@Module({
  imports: [PrismaModule, AnalyticsModule],
  controllers: [AdminVendorsController],
  providers: [
    VendorProfileRepository,
    JwtGuard,
    AdminGuard,
  ],
  exports: [VendorProfileRepository],
})
export class AdminVendorsModule {}
