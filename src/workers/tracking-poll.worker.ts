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
    const shipments = await this.escrowRepository.findShippedWithTracking();

    for (const escrow of shipments) {
      if (!escrow.trackingId) {
        continue;
      }

      try {
        const status = await this.logisticsService.getStatus(escrow.trackingId);
        if (status.status !== 'DELIVERED') {
          continue;
        }

        const deliveredAt = new Date();
        await this.escrowRepository.markDelivered(escrow.id, deliveredAt);
        try {
          await this.contractService.recordDelivery(escrow.id);
        } catch (contractError) {
          // If delivery was already recorded on-chain, treat as success.
          // The local write may have failed after a previous on-chain call.
          const msg = contractError instanceof Error ? contractError.message : String(contractError);
          if (msg.includes('DeliveryAlreadyRecorded')) {
            this.logger.log(`Delivery already recorded on-chain for escrow ${escrow.id}, marking delivered`);
          } else {
            throw contractError;
          }
        }
      } catch (error) {
        this.logger.error(
          `Tracking poll failed for escrow ${escrow.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }
}
