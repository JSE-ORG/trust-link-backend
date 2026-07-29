import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { EscrowRepository } from '../escrow/escrow.repository';
import { LogisticsService } from '../logistics/logistics.service';
import { ContractService } from '../stellar/contract.service';

const EVERY_10_MINUTES = 10 * 60 * 1000;

@Injectable()
export class TrackingPollWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TrackingPollWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly logisticsService: LogisticsService,
    private readonly contractService: ContractService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    this.timer = setInterval(() => {
      void this.run();
    }, EVERY_10_MINUTES);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    try {
      const shipments = await this.escrowRepository.findShippedWithTracking();

      for (const escrow of shipments) {
        if (!escrow.trackingId) {
          continue;
        }

        try {
          const status = await this.logisticsService.getStatus(
            escrow.trackingId,
          );
          if (status.status !== 'DELIVERED') {
            continue;
          }

          // Claim the escrow before any network call. This follows the same
          // claim-and-release pattern as AutoReleaseWorker (#507): if the
          // contract call fails, the claim is cleared so the next poll cycle
          // retries. Without this, a failed recordDelivery leaves the escrow
          // in DELIVERED state permanently out of sync with the chain.
          const claimed = await this.escrowRepository.claimDelivery(
            escrow.id,
          );
          if (!claimed) {
            continue;
          }

          try {
            await this.contractService.recordDelivery(escrow.id);
            await this.escrowRepository.markDelivered(
              escrow.id,
              new Date(),
            );
          } catch (error) {
            // Release the claim so the next poll cycle can retry.
            await this.escrowRepository.clearDeliveryClaim(escrow.id);
            throw error;
          }
        } catch (error) {
          this.logger.error(
            JSON.stringify({
              msg: 'tracking_poll.escrow_failed',
              escrowId: escrow.id,
              trackingId: escrow.trackingId,
              eventType: 'tracking_poll',
              error: error instanceof Error ? error.message : String(error),
            }),
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          msg: 'tracking_poll.worker_failed',
          eventType: 'tracking_poll',
          error: error instanceof Error ? error.message : String(error),
        }),
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
