import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EscrowRepository } from '../escrow/escrow.repository';
import { ContractService } from '../stellar/contract.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly escrowRepository: EscrowRepository,
    private readonly contractService: ContractService,
  ) {}

  /** Retrieves all open disputes (OPEN or UNDER_REVIEW status). */
  async getOpenDisputes() {
    return this.prisma.dispute.findMany({
      where: {
        status: {
          in: ['OPEN', 'UNDER_REVIEW'] as any,
        },
      },
    });
  }

  /** Resolves a dispute by submitting the contract action and finalizing escrow state. */
  async resolveDispute(
    escrowId: string,
    resolution: 'RELEASE' | 'REFUND',
  ) {
    const escrow = await this.escrowRepository.findById(escrowId);
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    if (escrow.state === 'COMPLETED' || escrow.state === 'REFUNDED') {
      throw new Error('Dispute has already been resolved');
    }

    await this.contractService.resolveDispute(escrowId, resolution);

    if (resolution === 'RELEASE') {
      return this.escrowRepository.markCompleted(escrowId);
    }
    return this.escrowRepository.markRefunded(escrowId);
  }

  /** Aggregates escrow, volume, participant, and dispute totals for admins. */
  async getPlatformStats() {
    const [allEscrows, allDisputes] = await Promise.all([
      this.prisma.escrow.findMany({}),
      this.prisma.dispute.findMany({}),
    ]);

    const totalEscrows = allEscrows.length;
    const totalVolume = allEscrows.reduce((sum, e) => sum + e.amount, 0);

    const escrowsByState: Record<string, number> = {};
    for (const e of allEscrows) {
      escrowsByState[e.state] = (escrowsByState[e.state] ?? 0) + 1;
    }

    const uniqueVendors = new Set(allEscrows.map((e) => e.vendorAddress)).size;
    const uniqueBuyers = new Set(allEscrows.map((e) => e.buyerAddress)).size;

    const totalDisputes = allDisputes.length;
    const openDisputes = allDisputes.filter(
      (d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW',
    ).length;

    const averageEscrowAmount =
      totalEscrows > 0 ? totalVolume / totalEscrows : 0;

    return {
      totalEscrows,
      totalVolume,
      escrowsByState,
      uniqueVendors,
      uniqueBuyers,
      totalDisputes,
      openDisputes,
      averageEscrowAmount,
    };
  }

  /** Lists all escrows with pagination and filtering support. */
  async listAllEscrows(query: {
    state?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const allEscrows = await this.prisma.escrow.findMany({
      where: query.state ? { state: query.state as any } : undefined,
    });

    const total = allEscrows.length;
    const start = (page - 1) * limit;
    const data = allEscrows.slice(start, start + limit);

    return { data, total, page, limit };
  }

  /** Lists all disputes with pagination and optional status filtering. */
  async listAllDisputes(query: {
    status?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const allDisputes = await this.prisma.dispute.findMany({
      where: query.status ? { status: query.status as any } : undefined,
    });

    const total = allDisputes.length;
    const start = (page - 1) * limit;
    const data = allDisputes.slice(start, start + limit);

    return { data, total, page, limit };
  }
}
