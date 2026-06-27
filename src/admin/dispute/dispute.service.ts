import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DisputeRecord, DisputeState, EscrowRecord, PrismaService } from '../../prisma/prisma.service';
import { EscrowRepository } from '../../escrow/escrow.repository';
import { ContractService } from '../../stellar/contract.service';

@Injectable()
export class DisputeService {
  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly contractService: ContractService,
    private readonly prisma: PrismaService,
  ) {}

  async getDisputes(query: {
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: DisputeRecord[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const allDisputes = await this.prisma.dispute.findMany({
      where: query.status ? { status: query.status as DisputeState } : undefined,
    });

    const total = allDisputes.length;
    const start = (page - 1) * limit;
    const data = allDisputes.slice(start, start + limit);
    return { data, total, page, limit };
  }

  /** Resolves a dispute by submitting the contract action and finalizing escrow state. */
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
