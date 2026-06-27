import { Injectable, Logger } from '@nestjs/common';
import { ContractService } from '../stellar/contract.service';
import { EscrowRepository } from './escrow.repository';
import { AUTO_RELEASE_DAYS } from './escrow.constants';
import { MILLISECONDS_PER_DAY } from '../common/constants/time.constants';

@Injectable()
export class AutoReleaseService {
  private readonly logger = new Logger(AutoReleaseService.name);

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly contractService: ContractService,
  ) {}

  /** Scans eligible delivered escrows and submits guarded auto-release transactions. */
  async run(): Promise<void> {
    const cutoff = new Date(Date.now() - AUTO_RELEASE_DAYS * MILLISECONDS_PER_DAY);

    const eligible =
      await this.escrowRepository.findAutoReleaseEligible(cutoff);

    if (eligible.length === 0) {
      return;
    }

    for (const escrow of eligible) {
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
        const txHash = await this.contractService.submitAutoRelease(escrow.id);
        await this.escrowRepository.markAutoReleased(escrow.id, txHash);
      } catch (err: unknown) {
        this.logger.error(
          `Auto-release failed for escrow ${escrow.id}`,
          err instanceof Error ? err : new Error(String(err)),
        );
        // Release the optimistic lock so the next cron tick can retry
        await this.escrowRepository.clearAutoReleaseSubmitting(escrow.id);
      }
    }
  }
}
