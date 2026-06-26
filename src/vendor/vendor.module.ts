import { Module } from '@nestjs/common';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';

@Module({
  imports: [PrismaModule],
  controllers: [VendorController],
  providers: [VendorService, JwtGuard],
  exports: [VendorService],
})
export class VendorModule {}
