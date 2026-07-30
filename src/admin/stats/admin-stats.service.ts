import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminStatsDto } from './dto/admin-stats.dto';

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Aggregates escrow, volume, participant, and dispute totals for admins. */
  async getStats(): Promise<AdminStatsDto> {
    const [
      aggregation,
      stateGroups,
      totalDisputes,
      openDisputes,
    ] = await Promise.all([
      this.prisma.escrow.aggregate({
        _sum: { amount: true },
        _count: { vendorAddress: true, buyerAddress: true },
      }),
      this.prisma.escrow.groupBy({
        by: ['state'],
        _count: true,
      }),
      this.prisma.dispute.count(),
      this.prisma.dispute.count({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } as any,
      }),
    ]);

    const totalEscrows =
      (stateGroups as Array<{ _count: number }>).reduce(
        (sum, g) => sum + g._count,
        0,
      );
    const totalVolume = aggregation._sum?.amount ?? 0;
    const uniqueVendors = aggregation._count?.vendorAddress ?? 0;
    const uniqueBuyers = aggregation._count?.buyerAddress ?? 0;
    const averageEscrowAmount =
      totalEscrows > 0 ? totalVolume / totalEscrows : 0;

    const escrowsByState: Record<string, number> = {};
    for (const group of stateGroups as Array<{
      state: string;
      _count: number;
    }>) {
      escrowsByState[group.state] = group._count;
    }

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
}
