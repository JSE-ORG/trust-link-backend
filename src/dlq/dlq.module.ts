import { Module } from '@nestjs/common';
import { StellarModule } from '../stellar/stellar.module';
import { ConfigModule } from '../config/config.module';
import { DlqService } from './dlq.service';
import { DlqController } from './dlq.controller';

@Module({
  imports: [ConfigModule, StellarModule],
  controllers: [DlqController],
  providers: [DlqService],
  exports: [DlqService],
})
export class DlqModule {}
