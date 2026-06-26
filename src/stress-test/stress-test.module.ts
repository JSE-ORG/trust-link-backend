import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StressTestService } from './stress-test.service';
import { StressTestController } from './stress-test.controller';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [StressTestController],
  providers: [StressTestService],
  exports: [StressTestService],
})
export class StressTestModule {}
