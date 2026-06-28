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

// Stellar address of the auto-release signing account. Must be set in production.
const AUTO_RELEASE_SOURCE =
  process.env.AUTO_RELEASE_SOURCE_ADDRESS ?? 'GAUTORELEASE000000000000000000000000000000000000000000000';

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
    let eligible: Awaited<
      ReturnType<typeof this.escrowRepository.findAutoReleaseEligible>
    > = [];
    let successCount = 0;
    let failureCount = 0;
    const failures: { escrowId: string; error: string }[] = [];

    try {
      eligible =
        await this.escrowRepository.findAutoReleaseEligible(referenceTime);

      for (const escrow of eligible) {
        try {
          const dispute = await this.disputeRepository.findByEscrow(escrow.id);
          if (dispute) {
            continue;
          }

          if (escrow.state === 'COMPLETED' || escrow.autoReleaseTxHash) {
            continue;
          }

          const txHash = await this.contractService.submitAutoRelease(
            escrow.id,
            AUTO_RELEASE_SOURCE,
          );
          await this.escrowRepository.markAutoReleaseCompleted(
            escrow.id,
            txHash,
          );
          successCount++;
        } catch (error) {
          failureCount++;
          failures.push({
            escrowId: escrow.id,
            error: error instanceof Error ? error.message : String(error),
          });
          this.logger.error(
            JSON.stringify({
              msg: 'auto_release.escrow_failed',
              escrowId: escrow.id,
              eventType: 'auto_release',
              error: error instanceof Error ? error.message : String(error),
            }),
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          msg: 'auto_release.worker_failed',
          eventType: 'auto_release',
          error: error instanceof Error ? error.message : String(error),
        }),
        error instanceof Error ? error.stack : undefined,
      );
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
