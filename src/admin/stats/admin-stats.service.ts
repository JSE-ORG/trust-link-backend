import { Injectable } from '@nestjs/common';
import { DisputeStatusEnum } from '../../common/enums/escrow-state.enum';
import { AdminStatsRepository } from './admin-stats.repository';
import { AdminStatsDto } from './dto/admin-stats.dto';

/** Dispute statuses an admin still has to act on. */
const OPEN_DISPUTE_STATUSES: readonly string[] = [
  DisputeStatusEnum.OPEN,
  DisputeStatusEnum.UNDER_REVIEW,
];

@Injectable()
export class AdminStatsService {
  constructor(private readonly stats: AdminStatsRepository) {}

  /**
   * Aggregates escrow, volume, participant, and dispute totals for admins.
   *
   * The queries live in {@link AdminStatsRepository} (R-DB-02, issue #846);
   * this composes them into the dashboard's response shape.
   */
  async getStats(): Promise<AdminStatsDto> {
    const [
      aggregation,
      stateGroups,
      uniqueVendorsResult,
      uniqueBuyersResult,
      totalDisputes,
      openDisputes,
    ] = await Promise.all([
      this.prisma.escrow.aggregate({
        _sum: { amount: true },
      }),
      this.prisma.escrow.groupBy({
        by: ['state'],
        _count: true,
      }),
      // Count distinct vendors in SQL
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT "vendorAddress") as count FROM "Escrow"
      `,
      // Count distinct buyers in SQL
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT "buyerAddress") as count FROM "Escrow"
      `,
      this.prisma.dispute.count(),
      this.prisma.dispute.count({
        where: {
          status: {
            in: [DisputeStatusEnum.OPEN, DisputeStatusEnum.UNDER_REVIEW],
          },
        },
      }),
    const [totals, totalDisputes, openDisputes] = await Promise.all([
      this.stats.collectTotals(),
      this.stats.countDisputes(),
      this.stats.countOpenDisputes(OPEN_DISPUTE_STATUSES),
    ]);

    const totalEscrows = totals.stateGroups.reduce(
      (sum, group) => sum + group._count,
      0,
    );
    const totalVolume = Number(aggregation._sum?.amount ?? 0);
    const uniqueVendors = Number(uniqueVendorsResult[0].count);
    const uniqueBuyers = Number(uniqueBuyersResult[0].count);
    const totalVolume = totals.totalVolume;
    const averageEscrowAmount =
      totalEscrows > 0 ? totalVolume / totalEscrows : 0;

    const escrowsByState: Record<string, number> = {};
    for (const group of totals.stateGroups) {
      escrowsByState[group.state] = group._count;
    }

    return {
      totalEscrows,
      totalVolume,
      escrowsByState,
      uniqueVendors: totals.uniqueVendors,
      uniqueBuyers: totals.uniqueBuyers,
      totalDisputes,
      openDisputes,
      averageEscrowAmount,
    };
  }
}
