import { forwardRef, Module } from '@nestjs/common';
import { ContractService } from './contract.service';
import { STELLAR_SERVER } from './stellar.tokens';
import { EventReplayService } from './event-replay.service';
import { BlockchainListenerService } from './blockchain-listener.service';
import { CursorService } from './cursor.service';
import { SorobanPollerService } from './soroban-poller.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EscrowModule } from '../escrow/escrow.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [
    forwardRef(() => WebhooksModule),
    forwardRef(() => EscrowModule),
    PrismaModule,
    ConfigModule,
  ],
  providers: [
    ContractService,
    EventReplayService,
    BlockchainListenerService,
    CursorService,
    SorobanPollerService,
    { provide: STELLAR_SERVER, useValue: undefined },
  ],
  exports: [ContractService, BlockchainListenerService, CursorService],
})
export class StellarModule {}
