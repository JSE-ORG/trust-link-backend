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

    for (const escrow of eligible) {
      const dispute = await this.disputeRepository.findByEscrow(escrow.id);
      if (dispute) {
        continue;
      }

      if (escrow.state === 'COMPLETED' || escrow.autoReleaseTxHash) {
        continue;
      }

      try {
        const txHash = await this.contractService.submitAutoRelease(escrow.id);
        await this.escrowRepository.markAutoReleaseCompleted(escrow.id, txHash);
      } catch (error) {
        this.logger.error(
          `Auto release failed for escrow ${escrow.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }
}
