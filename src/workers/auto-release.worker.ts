import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { EscrowRepository } from '../escrow/escrow.repository';
import { ContractService } from '../stellar/contract.service';

const EVERY_5_MINUTES = 5 * 60 * 1000;

/**
 * Stellar address of the auto-release signing account.
 * Must be set in production via AUTO_RELEASE_SOURCE_ADDRESS env var.
 */
function getAutoReleaseSource(): string {
  const source = process.env.AUTO_RELEASE_SOURCE_ADDRESS;
  if (!source) {
    throw new Error(
      'AUTO_RELEASE_SOURCE_ADDRESS is not set. Auto-release is disabled.',
    );
  }
  return source;
}

@Injectable()
export class AutoReleaseWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AutoReleaseWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly autoReleaseSource: string;

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly contractService: ContractService,
  ) {
    // Validate at construction time so we fail fast
    this.autoReleaseSource = getAutoReleaseSource();
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
          // DB-level optimistic lock: atomically claim the escrow before any
          // network call. Returns null if another worker already holds the lock.
          const claimed = await this.escrowRepository.markAutoReleaseSubmitting(
            escrow.id,
          );
          if (!claimed) {
            this.logger.log(
              `Skipping escrow ${escrow.id} — already claimed by another worker`,
            );
            continue;
          }

          try {
            const txHash = await this.contractService.submitAutoRelease(
              escrow.id,
              this.autoReleaseSource,
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
            // Release the optimistic lock so the next cron tick can retry
            await this.escrowRepository.clearAutoReleaseSubmitting(escrow.id);
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
        } catch (error) {
          failureCount++;
          failures.push({
            escrowId: escrow.id,
            error: error instanceof Error ? error.message : String(error),
          });
          this.logger.error(
            JSON.stringify({
              msg: 'auto_release.escrow_lock_failed',
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
