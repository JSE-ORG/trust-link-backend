import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { DisputeRepository } from '../dispute/dispute.repository';
import { EscrowRepository } from '../escrow/escrow.repository';
import { ContractService } from '../stellar/contract.service';

const EVERY_5_MINUTES = 5 * 60 * 1000;

@Injectable()
export class AutoReleaseWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AutoReleaseWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly disputeRepository: DisputeRepository,
    private readonly contractService: ContractService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    this.timer = setInterval(() => {
      void this.run();
    }, EVERY_5_MINUTES);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(referenceTime = new Date()): Promise<void> {
    const eligible =
      await this.escrowRepository.findAutoReleaseEligible(referenceTime);

    if (eligible.length === 0) {
      return;
    }

    let successCount = 0;
    let failureCount = 0;
    const failures: Array<{ escrowId: string; error: string }> = [];

    this.logger.log(
      `Processing batch of ${eligible.length} eligible escrow(s) for auto-release`,
    );

    for (const escrow of eligible) {
      try {
        const dispute = await this.disputeRepository.findByEscrow(escrow.id);
        if (dispute) {
          this.logger.debug(
            `Skipping escrow ${escrow.id} — active dispute found`,
          );
          continue;
        }

        if (escrow.state === 'COMPLETED' || escrow.autoReleaseTxHash) {
          this.logger.debug(
            `Skipping escrow ${escrow.id} — already completed or released`,
          );
          continue;
        }

        const txHash = await this.contractService.submitAutoRelease(escrow.id);
        await this.escrowRepository.markAutoReleaseCompleted(escrow.id, txHash);
        successCount++;
        this.logger.log(
          `Auto-release succeeded for escrow ${escrow.id} (tx: ${txHash})`,
        );
      } catch (error) {
        failureCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        failures.push({ escrowId: escrow.id, error: errorMessage });

        this.logger.error(
          `Auto-release failed for escrow ${escrow.id}: ${errorMessage}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    // Summary log for batch processing
    this.logger.log(
      `Batch complete: ${successCount} succeeded, ${failureCount} failed out of ${eligible.length} total`,
    );

    if (failures.length > 0) {
      this.logger.warn(
        `Failed escrows: ${failures.map((f) => `${f.escrowId} (${f.error})`).join(', ')}`,
      );
    }
  }
}
