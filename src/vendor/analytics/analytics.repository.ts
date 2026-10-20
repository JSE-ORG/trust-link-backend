import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** One row returned by the daily volume raw aggregation query. */
export interface DailyVolumeAggRow {
  date: string | Date;
  totalVolume: number | string;
  transactionCount: number | string;
  completedCount: number | string;
  disputedCount: number | string;
}

/** One row of the `escrow.groupBy({ by: ['state'] })` aggregation result. */
export interface AnalyticsEscrowStateGroup {
  state: string;
  _count?: number | { _all?: number };
  _sum?: { amount?: Prisma.Decimal | null } | null;
}

/**
 * Repository owning all analytics database operations (R-DB-02, issue #942).
 *
 * Services must not call Prisma directly. Moving raw SQL aggregates and group-by
 * queries here decouples business analytics calculations from database access.
 */
@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves daily transaction volume aggregations for a vendor within the given date window and timezone.
   * Uses raw SQL for database-level aggregation with proper timezone handling.
   */
  async aggregateDailyVolume(
    vendorAddress: string,
    startDate: Date,
    endDate: Date,
    timezone: string = 'UTC',
  ): Promise<DailyVolumeAggRow[]> {
    return this.prisma.$queryRaw<DailyVolumeAggRow[]>`
      SELECT 
        DATE(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date as date,
        COALESCE(SUM("amount"), 0) as "totalVolume",
        COUNT(*) as "transactionCount",
        SUM(CASE WHEN "state" IN ('COMPLETED', 'RELEASED') THEN 1 ELSE 0 END) as "completedCount",
        SUM(CASE WHEN "state" = 'DISPUTED' THEN 1 ELSE 0 END) as "disputedCount"
      FROM "Escrow"
      WHERE 
        "vendorAddress" = ${vendorAddress}
        AND "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
  }

  /**
   * Aggregates a vendor's escrows grouped by state with count and exact Decimal sum.
   */
  async getEscrowStateGroups(
    vendorAddress: string,
  ): Promise<AnalyticsEscrowStateGroup[]> {
    const groups = await this.prisma.escrow.groupBy({
      by: ['state'],
      where: { vendorAddress },
      _count: true,
      _sum: { amount: true },
    });
    return groups as AnalyticsEscrowStateGroup[];
  }

  /**
   * Retrieves the vendor's configured tracking notification channels, or null if no settings row exists.
   */
  async findNotificationChannels(
    vendorAddress: string,
  ): Promise<string[] | null> {
    const trackingSettings =
      await this.prisma.vendorTrackingSettings.findUnique({
        where: { vendorAddress },
        select: {
          notificationChannels: true,
        },
      });

    return trackingSettings?.notificationChannels ?? null;
  }
}
