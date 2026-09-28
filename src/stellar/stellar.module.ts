import { forwardRef, Module } from '@nestjs/common';
import { rpc } from '@stellar/stellar-sdk';
import { ContractService } from './contract.service';
import { STELLAR_SERVER } from './stellar.tokens';
import { EventReplayService } from './event-replay.service';
import { BlockchainListenerService } from './blockchain-listener.service';
import { CursorService } from './cursor.service';
import { CursorRepository } from './cursor.repository';
import { SorobanPollerService } from './soroban-poller.service';
import { HorizonService } from './horizon.service';
import { SorobanHealthService } from './soroban-health.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EscrowModule } from '../escrow/escrow.module';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { DlqModule } from '../dlq/dlq.module';
import { resolveStellarServerRpcUrl } from './stellar-endpoint-resolver';

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
    CursorRepository,
    SorobanPollerService,
    HorizonService,
    // #841 — Checks the RPC server below, so the readiness probe reports the
    // same endpoint every contract call is submitted through.
    SorobanHealthService,
    {
      provide: STELLAR_SERVER,
      useFactory: (config: ConfigService) => {
        const rpcUrl = resolveStellarServerRpcUrl(config);
        return new rpc.Server(rpcUrl);
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    ContractService,
    BlockchainListenerService,
    CursorService,
    HorizonService,
    SorobanHealthService,
    STELLAR_SERVER,
  ],
})
export class StellarModule {}
