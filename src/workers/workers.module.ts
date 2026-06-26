import { Module } from '@nestjs/common';
import { DisputeModule } from '../dispute/dispute.module';
import { EscrowModule } from '../escrow/escrow.module';
import { StellarModule } from '../stellar/stellar.module';
import { AutoReleaseWorker } from './auto-release.worker';
import { TrackingPollWorker } from './tracking-poll.worker';

@Module({
  imports: [EscrowModule, DisputeModule, StellarModule],
  providers: [AutoReleaseWorker, TrackingPollWorker],
  exports: [AutoReleaseWorker, TrackingPollWorker],
})
export class WorkersModule {}
