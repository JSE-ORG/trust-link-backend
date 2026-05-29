import { Global, Module } from '@nestjs/common';
import { LogisticsService } from './logistics.service';

@Global()
@Module({
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
