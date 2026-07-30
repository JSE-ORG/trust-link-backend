import { forwardRef, Module } from '@nestjs/common';
import { ContractService } from './contract.service';
import { STELLAR_SERVER } from './stellar.tokens';
import { EventReplayService } from './event-replay.service';
import { BlockchainListenerService } from './blockchain-listener.service';
import { CursorService } from './cursor.service';
import { SorobanPollerService } from './soroban-poller.service';
import { HorizonService } from './horizon.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EscrowModule } from '../escrow/escrow.module';
import { ConfigModule } from '../config/config.module';
import { DlqModule } from '../dlq/dlq.module';

@Module({
  imports: [
    forwardRef(() => WebhooksModule),
    forwardRef(() => EscrowModule),
    // Issue #554: SorobanPollerService dead-letters events it can't apply
    // via DlqService. See dlq.module.ts for the forwardRef on the other side.
    forwardRef(() => DlqModule),
    PrismaModule,
    ConfigModule,
  ],
  providers: [
    ContractService,
    EventReplayService,
    BlockchainListenerService,
    CursorService,
    SorobanPollerService,
    HorizonService,
    { provide: STELLAR_SERVER, useValue: undefined },
  ],
  exports: [
    ContractService,
    BlockchainListenerService,
    CursorService,
    HorizonService,
  ],
})
export class StellarModule {}
