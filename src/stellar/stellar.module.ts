import { forwardRef, Module } from '@nestjs/common';
import { ContractService } from './contract.service';
import { STELLAR_SERVER } from './stellar.tokens';
import { EventReplayService } from './event-replay.service';
import { BlockchainListenerService } from './blockchain-listener.service';
import { CursorService } from './cursor.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [forwardRef(() => WebhooksModule), PrismaModule],
  providers: [
    ContractService,
    EventReplayService,
    BlockchainListenerService,
    CursorService,
    { provide: STELLAR_SERVER, useValue: undefined },
  ],
  exports: [ContractService, BlockchainListenerService, CursorService],
})
export class StellarModule {}
