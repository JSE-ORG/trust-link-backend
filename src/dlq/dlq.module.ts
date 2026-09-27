import { forwardRef, Module } from '@nestjs/common';
import { StellarModule } from '../stellar/stellar.module';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EscrowModule } from '../escrow/escrow.module';
import { DlqService } from './dlq.service';
import { DlqController } from './dlq.controller';
import { FailedTransactionRepository } from './failed-transaction.repository';

@Module({
  // Issue #554: SorobanPollerService (in StellarModule) now depends on
  // DlqService to dead-letter events it can't apply, and DlqModule already
  // imports StellarModule for the replay path — forwardRef breaks the
  // resulting circular import.
  imports: [
    ConfigModule,
    forwardRef(() => StellarModule),
    PrismaModule,
    // Issue #844: the controller resolves the on-chain escrow id through
    // EscrowRepository rather than PrismaService.
    EscrowModule,
  ],
  controllers: [DlqController],
  providers: [DlqService, FailedTransactionRepository],
  exports: [DlqService, FailedTransactionRepository],
})
export class DlqModule {}
