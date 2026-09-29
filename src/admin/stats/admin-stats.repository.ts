import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** One row of the `escrow.groupBy({ by: ['state'] })` result. */
export interface EscrowStateGroup {
  state: string;
  _count: number;
}

/** Raw aggregates behind the admin dashboard response. */
export interface AdminStatsTotals {
  totalVolume: number;
  stateGroups: EscrowStateGroup[];
  uniqueVendors: number;
  uniqueBuyers: number;
}

/**
 * Aggregates the platform totals behind the admin dashboard
 * (R-DB-02, issue #846 — the queries moved here from the service).
 *
 * Keeping the aggregation in one repository is what lets the dashboard load
 * every number from a single round of parallel queries, and keeps the
 * "distinct participants" caveat documented next to the query that produced it.
 */
@Injectable()
export class AdminStatsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs the dashboard's aggregate queries in parallel and returns raw
   * shapes; the service composes them into the response DTO.
   */
  async collectTotals(): Promise<AdminStatsTotals> {
    const [aggregation, stateGroups, vendorGroups, buyerGroups] =
      await Promise.all([
        this.prisma.escrow.aggregate({
          _sum: { amount: true },
        }),
        this.prisma.escrow.groupBy({
          by: ['state'],
          _count: true,
        }),
        // Distinct participants, via groupBy. `aggregate._count.vendorAddress`
        // counts non-null *rows*, not distinct values, so it reported the
        // total escrow count under the name "unique vendors".
        this.prisma.escrow.groupBy({ by: ['vendorAddress'] }),
        this.prisma.escrow.groupBy({ by: ['buyerAddress'] }),
      ]);

    return {
      totalVolume: Number(aggregation._sum?.amount ?? 0),
      stateGroups: stateGroups,
      uniqueVendors: vendorGroups.length,
      uniqueBuyers: buyerGroups.length,
    };
  }

  /** Counts every dispute on the platform. */
  countDisputes(): Promise<number> {
    return this.prisma.dispute.count();
  }

  /**
   * Counts disputes still awaiting resolution — `OPEN` or `UNDER_REVIEW`,
   * the two statuses an admin has to act on.
   */
  countOpenDisputes(openStatuses: readonly string[]): Promise<number> {
    return this.prisma.dispute.count({
      where: {
        status: { in: [...openStatuses] },
      },
    });
  }
}
