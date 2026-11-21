import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** One row of the `escrow.groupBy({ by: ['state'] })` result. */
export interface EscrowStateGroup {
  state: string;
  _count: number;
}

/** One row returned by the daily admin stats raw aggregation query. */
export interface DailyAdminStatsRow {
  date: Date | string;
  escrowsCreated: bigint | number | string;
  volume: number | string;
  completed: bigint | number | string;
  disputed: bigint | number | string;
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
    type CountRow = [{ count: bigint }];

    const [aggregation, stateGroups, vendorCountRows, buyerCountRows] =
      await Promise.all([
        this.prisma.escrow.aggregate({
          _sum: { amount: true },
        }),
        this.prisma.escrow.groupBy({
          by: ['state'],
          _count: true,
        }),
        // COUNT(DISTINCT ...) in SQL — avoids transferring one row per escrow
        // just to count distinct addresses (issue #1055).
        this.prisma.$queryRaw<CountRow>`
          SELECT COUNT(DISTINCT "vendorAddress")::bigint AS count FROM "Escrow"
        `,
        this.prisma.$queryRaw<CountRow>`
          SELECT COUNT(DISTINCT "buyerAddress")::bigint AS count FROM "Escrow"
        `,
      ]);

    return {
      totalVolume: Number(aggregation._sum?.amount ?? 0),
      stateGroups: stateGroups,
      uniqueVendors: Number(vendorCountRows[0]?.count ?? 0),
      uniqueBuyers: Number(buyerCountRows[0]?.count ?? 0),
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

  /**
   * Aggregates daily platform stats (escrows created, volume, completed, disputed)
   * grouped by calendar day between startDate and endDate.
   */
  async aggregateDailyStats(
    startDate: Date,
    endDate: Date,
  ): Promise<DailyAdminStatsRow[]> {
    return this.prisma.$queryRaw<DailyAdminStatsRow[]>`
      SELECT
        DATE_TRUNC('day', "createdAt")::date AS date,
        COUNT(*)::bigint AS "escrowsCreated",
        COALESCE(SUM("amount"), 0)::float AS volume,
        SUM(CASE WHEN "state" IN ('COMPLETED', 'RELEASED') THEN 1 ELSE 0 END)::bigint AS completed,
        SUM(CASE WHEN "state" = 'DISPUTED' OR "disputeId" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS disputed
      FROM "Escrow"
      WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
      GROUP BY DATE_TRUNC('day', "createdAt")::date
      ORDER BY date ASC
    `;
  }
}
