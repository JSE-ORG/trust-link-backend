import { Injectable, Logger } from '@nestjs/common';
import { ContractService } from '../stellar/contract.service';
import { EscrowRepository } from './escrow.repository';

/** Number of days after shipment before an escrow qualifies for auto-release. */
const AUTO_RELEASE_DAYS = 7;

@Injectable()
export class AutoReleaseService {
  private readonly logger = new Logger(AutoReleaseService.name);

  /**
   * In-process guard: IDs already submitted for release (or currently in-flight).
   * Cleared only on failure so that an unhappy escrow can be retried on the next
   * cron tick, while a successfully submitted one is never double-submitted.
   * In production the authoritative idempotency check is the DB state change to
   * RELEASED which prevents `findAutoReleaseEligible` from returning it again.
   */
  private readonly processingIds = new Set<string>();

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly contractService: ContractService,
  ) {}

  async run(): Promise<void> {
    const cutoff = new Date(
      Date.now() - AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000,
    );

    const eligible = await this.escrowRepository.findAutoReleaseEligible(cutoff);

    if (eligible.length === 0) {
      return;
    }

    for (const escrow of eligible) {
      if (this.processingIds.has(escrow.id)) {
        continue; // idempotency: already processed in a prior run
      }

      this.processingIds.add(escrow.id);

      try {
        await this.contractService.submitAutoRelease(escrow.id);
        await this.escrowRepository.markReleased(escrow.id);
      } catch (err: unknown) {
        this.logger.error(
          `Auto-release failed for escrow ${escrow.id}`,
          err instanceof Error ? err : new Error(String(err)),
        );
        // Remove from set so the next cron tick can retry
        this.processingIds.delete(escrow.id);
      }
    }
  }
}
