import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { DisputeRepository } from '../dispute/dispute.repository';
import { EscrowRepository } from '../escrow/escrow.repository';
import { ContractService } from '../stellar/contract.service';

const EVERY_5_MINUTES = 5 * 60 * 1000;

@Injectable()
export class AutoReleaseWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AutoReleaseWorker.name);
  private readonly autoReleaseSource: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly disputeRepository: DisputeRepository,
    private readonly contractService: ContractService,
    private readonly configService: ConfigService,
  ) {
    this.autoReleaseSource = this.configService.get(
      'AUTO_RELEASE_SOURCE_ADDRESS',
    );
    if (!this.autoReleaseSource) {
      throw new Error(
        'AUTO_RELEASE_SOURCE_ADDRESS is not configured — the application fails to start without a valid auto-release signing address.',
      );
    }
  }

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

          if (escrow.state === 'RELEASED' || escrow.autoReleaseTxHash) {
            continue;
          }

          // Atomically claim the escrow before any network call. This is the
          // guard against the race where two concurrent runs fetch the same
          // stale eligible snapshot — a stale in-memory check alone cannot
          // prevent both from submitting. Returns null if another run
          // already holds the claim.
          const claimed = await this.escrowRepository.markAutoReleaseSubmitting(
            escrow.id,
          );
          if (!claimed) {
            continue;
          }

          try {
            const txHash = await this.contractService.submitAutoRelease(
              escrow.id,
              this.autoReleaseSource,
            );
            await this.escrowRepository.markAutoReleased(escrow.id, txHash);
            successCount++;
          } catch (error) {
            // Release the claim so the next poll cycle can retry.
            await this.escrowRepository.clearAutoReleaseSubmitting(escrow.id);
            throw error;
          }
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
