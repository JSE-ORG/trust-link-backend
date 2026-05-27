import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EscrowRecord } from '../../prisma/prisma.service';
import { EscrowRepository } from '../../escrow/escrow.repository';
import { ContractService } from '../../stellar/contract.service';

@Injectable()
export class DisputeService {
  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly contractService: ContractService,
  ) {}

  async resolve(
    escrowId: string,
    resolution: 'RELEASE' | 'REFUND',
  ): Promise<EscrowRecord> {
    const escrow = await this.escrowRepository.findById(escrowId);
    if (!escrow) {
      throw new NotFoundException('Escrow not found');
    }

    if (escrow.state === 'COMPLETED' || escrow.state === 'REFUNDED') {
      throw new ConflictException('Dispute has already been resolved');
    }

    await this.contractService.resolveDispute(escrowId, resolution);

    if (resolution === 'RELEASE') {
      return this.escrowRepository.markCompleted(escrowId);
    }
    return this.escrowRepository.markRefunded(escrowId);
  }
}
