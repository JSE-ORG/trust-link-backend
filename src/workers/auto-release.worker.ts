import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { DisputeRepository } from '../dispute/dispute.repository';
import { EscrowRepository } from '../escrow/escrow.repository';
import { ContractService } from '../stellar/contract.service';
import { ConfigService } from '../config/config.service';
import { FIVE_MINUTES_MS } from '../common/constants/time.constants';

/**
 * States an escrow can no longer move out of. Mirrors the set in
 * `escrow.service.ts`, which gates the chain-event handlers.
 */
const TERMINAL_STATES = new Set<string>([
  'COMPLETED',
  'RELEASED',
  'REFUNDED',
  'CANCELLED',
]);

@Injectable()
export class AutoReleaseWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AutoReleaseWorker.name);
  private timer: NodeJS.Timeout | null = null;

  /**
   * #840 — True while a run is in progress.
   *
   * `setInterval` fires every 5 minutes regardless of whether the previous
   * run finished, and a run submits one on-chain transaction per eligible
   * escrow, so a run that takes longer than the interval overlaps the next
   * one. Overlapping runs both read the same eligible snapshot and both walk
   * it; `markAutoReleaseSubmitting` stops a double *submission* per escrow, but
   * the second run still issues every eligibility query and dispute lookup
   * against the database for a set of escrows the first run is already
   * handling, and its summary log then reports those escrows as its own work.
   *
   * The claim is what makes correctness safe; this flag stops the wasted
   * duplicate cycle. `SorobanPollerService.poll()` guards the same way.
   */
  private running = false;

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly disputeRepository: DisputeRepository,
    private readonly contractService: ContractService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Returns the configured auto-release signing address.
   *
   * Delegates to `ConfigService.requireAutoReleaseSourceAddress` (#672) — the
   * single copy of this check, shared with `dlq.controller.ts`. On the unset
   * path it throws `AutoReleaseSourceNotConfiguredError` (an `Error`
   * subclass), which this worker's own cycle handler catches and logs, then
   * clears the auto-release claim — same observable behaviour as before,
   * just a named error and a slightly different message.
   *
   * Resolved on use, not as a constructor dependency:
   * `AUTO_RELEASE_SOURCE_ADDRESS` is deliberately optional (#500), so a
   * constructor throw would block the whole application boot when it is
   * unset, not just the auto-release path.
   */
  private requireAutoReleaseSource(): string {
    return this.configService.requireAutoReleaseSourceAddress();
  }

  onModuleInit(): void {
    if (this.configService.get('NODE_ENV') === 'test') {
      return;
    }

    this.timer = setInterval(() => {
      void this.run();
    }, FIVE_MINUTES_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(referenceTime = new Date()): Promise<void> {
    // #840 — Skip a tick that arrives while the previous run is still going,
    // rather than starting a second overlapping cycle.
    if (this.running) {
      this.logger.warn(
        'AutoReleaseWorker: previous run is still in progress — skipping this tick',
      );
      return;
    }
    this.running = true;

    try {
      await this.runCycle(referenceTime);
    } finally {
      // Cleared even when the cycle throws, or the worker would refuse every
      // subsequent tick and silently stop releasing escrows for the lifetime
      // of the process.
      this.running = false;
    }
  }

  private async runCycle(referenceTime: Date): Promise<void> {
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

          // Belt and braces against a stale snapshot: findAutoReleaseEligible
          // already excludes both of these, but two concurrent runs share one
          // snapshot, and the chain event may have finalised the escrow since.
          if (TERMINAL_STATES.has(escrow.state) || escrow.autoReleaseTxHash) {
            continue;
          }

          // `auto_release(env, escrow_id: u64)` addresses the escrow by the
          // contract's own id, not this row's UUID. Without the mapping there
          // is no call to make, and guessing would target another escrow.
          if (escrow.contractEscrowId === null) {
            this.logger.warn(
              JSON.stringify({
                msg: 'auto_release.unmapped_escrow',
                escrowId: escrow.id,
                eventType: 'auto_release',
              }),
            );
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
              escrow.contractEscrowId,
              this.requireAutoReleaseSource(),
            );
            // Record the submission only. The AutoReleased chain event
            // owns the terminal transition and the completion notification;
            // see EscrowRepository.recordAutoReleaseSubmission.
            await this.escrowRepository.recordAutoReleaseSubmission(
              escrow.id,
              txHash,
            );
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
