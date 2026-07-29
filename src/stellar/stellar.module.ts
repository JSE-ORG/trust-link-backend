import { forwardRef, Module } from '@nestjs/common';
import { rpc } from '@stellar/stellar-sdk';
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
import { ConfigService } from '../config/config.service';

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
    {
      provide: STELLAR_SERVER,
      useFactory: (config: ConfigService) => {
        const rpcUrl =
          config.get('SOROBAN_RPC_URL') ||
          (config.get('STELLAR_NETWORK') === 'MAINNET'
            ? 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc'
            : 'https://soroban-testnet.stellar.org');
        return new rpc.Server(rpcUrl);
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    ContractService,
    BlockchainListenerService,
    CursorService,
    STELLAR_SERVER,
  ],
})
export class StellarModule {}
