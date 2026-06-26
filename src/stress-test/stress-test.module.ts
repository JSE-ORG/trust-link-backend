import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { StressTestService } from './stress-test.service';
import { StressTestController } from './stress-test.controller';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [StressTestController],
  providers: [StressTestService, JwtGuard, AdminGuard],
  exports: [StressTestService],
})
export class StressTestModule {}
