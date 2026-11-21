import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsController } from './analytics.controller';
import { VendorAccountDetailsRepository } from '../vendor-account-details.repository';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsRepository,
    VendorAccountDetailsRepository,
  ],
  exports: [AnalyticsService, AnalyticsRepository],
})
export class AnalyticsModule {}
