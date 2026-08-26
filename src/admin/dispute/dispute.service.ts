import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DisputeRecord,
  DisputeState,
  EscrowRecord,
  PrismaService,
  toDisputeRecord,
} from '../../prisma/prisma.service';
import { EscrowRepository } from '../../escrow/escrow.repository';
import { ContractService } from '../../stellar/contract.service';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class DisputeService {
  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly contractService: ContractService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Returns the contract admin address, or throws.
   *
   * `resolve_dispute` calls `caller.require_auth()` and the contract only
   * accepts an authorised resolver, so this is the address the call has to be
   * made and signed with. Resolved on use rather than in the constructor so an
   * unset value fails this path instead of application boot.
   */
  private requireAdminAddress(): string {
    const address = this.configService.get<string>('ADMIN_ADDRESS');
    if (!address) {
      throw new ConflictException(
        'ADMIN_ADDRESS is not configured; cannot resolve disputes on-chain.',
      );
    }
    return address;
  }

  async getDisputes(query: {
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: DisputeRecord[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where = query.status
      ? { status: query.status as DisputeState }
      : undefined;

    const [data, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return { data: data.map(toDisputeRecord), total, page, limit };
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

    // `resolve_dispute(env, caller: Address, escrow_id: u64, resolution)`
    // addresses the escrow by the contract's own id, and require_auth()s the
    // caller. Without the mapping there is no valid on-chain call to make.
    if (escrow.contractEscrowId === null) {
      throw new ConflictException(
        'Escrow has no contractEscrowId, so the dispute cannot be resolved on-chain.',
      );
    }

    await this.contractService.resolveDispute(
      escrow.contractEscrowId,
      resolution,
      this.requireAdminAddress(),
    );

    const dispute = await this.prisma.dispute.findFirst({
      where: { escrowId, status: 'OPEN' },
    });
    if (dispute) {
      await this.prisma.dispute.update({
        where: { id: dispute.id },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
    }

    if (resolution === 'RELEASE') {
      return this.escrowRepository.markCompleted(escrowId);
    }
    return this.escrowRepository.markRefunded(escrowId);
  }
}
