import { forwardRef, Module } from '@nestjs/common';
import { StellarModule } from '../stellar/stellar.module';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DlqService } from './dlq.service';
import { DlqController } from './dlq.controller';

@Module({
  // Issue #554: SorobanPollerService (in StellarModule) now depends on
  // DlqService to dead-letter events it can't apply, and DlqModule already
  // imports StellarModule for the replay path — forwardRef breaks the
  // resulting circular import.
  imports: [ConfigModule, forwardRef(() => StellarModule), PrismaModule],
  controllers: [DlqController],
  providers: [DlqService],
  exports: [DlqService],
})
export class DlqModule {}
