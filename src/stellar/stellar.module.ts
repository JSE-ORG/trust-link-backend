import { forwardRef, Module } from '@nestjs/common';
import { ContractService } from './contract.service';
import { STELLAR_SERVER } from './stellar.tokens';
import { EventReplayService } from './event-replay.service';
import { BlockchainListenerService } from './blockchain-listener.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [forwardRef(() => WebhooksModule)],
  providers: [
    ContractService,
    EventReplayService,
    BlockchainListenerService,
    { provide: STELLAR_SERVER, useValue: undefined },
  ],
  exports: [ContractService, BlockchainListenerService],
})
export class StellarModule {}
