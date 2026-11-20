import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { VendorProfileRepository } from '../../vendor/vendor-profile.repository';
import { AdminVendorsController } from './admin-vendors.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AdminVendorsController],
  providers: [VendorProfileRepository],
  exports: [VendorProfileRepository],
})
export class AdminVendorsModule {}
