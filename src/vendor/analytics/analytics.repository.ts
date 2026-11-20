import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** One row returned by the volume raw aggregation query. */
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

/** Result of SQL aggregation for shipping and delivery times (issue #1154). */
export interface ShippingAndDeliveryTimes {
  averageHoursToShip: number | null;
  averageHoursToDeliver: number | null;
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
   * Retrieves transaction volume aggregations for a vendor within the given date window, timezone, and interval.
   * Uses raw SQL with DATE_TRUNC for database-level aggregation with proper timezone handling (issue #1155).
   */
  async aggregateDailyVolume(
    vendorAddress: string,
    startDate: Date,
    endDate: Date,
    timezone: string = 'UTC',
    interval: 'day' | 'week' | 'month' = 'day',
  ): Promise<DailyVolumeAggRow[]> {
    if (interval === 'week') {
      return this.prisma.$queryRaw<DailyVolumeAggRow[]>`
        SELECT 
          DATE_TRUNC('week', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date as date,
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
    if (interval === 'month') {
      return this.prisma.$queryRaw<DailyVolumeAggRow[]>`
        SELECT 
          DATE_TRUNC('month', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date as date,
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
    return this.prisma.$queryRaw<DailyVolumeAggRow[]>`
      SELECT 
        DATE_TRUNC('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date as date,
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
   * Computes the average hours to ship and deliver for the vendor in SQL (issue #1154).
   * - Time to ship: from createdAt to shippedAt
   * - Time to deliver: from shippedAt to deliveredAt
   */
  async getAverageShippingAndDeliveryTimes(
    vendorAddress: string,
  ): Promise<ShippingAndDeliveryTimes> {
    const result = await this.prisma.$queryRaw<
      Array<{
        averageHoursToShip: number | string | null;
        averageHoursToDeliver: number | string | null;
      }>
    >`
      SELECT 
        AVG(CASE WHEN "shippedAt" IS NOT NULL AND "shippedAt" >= "createdAt" 
            THEN EXTRACT(EPOCH FROM ("shippedAt" - "createdAt")) / 3600.0 
            ELSE NULL END) as "averageHoursToShip",
        AVG(CASE WHEN "deliveredAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" >= "shippedAt" 
            THEN EXTRACT(EPOCH FROM ("deliveredAt" - "shippedAt")) / 3600.0 
            ELSE NULL END) as "averageHoursToDeliver"
      FROM "Escrow"
      WHERE "vendorAddress" = ${vendorAddress}
    `;

    const row = result[0];
    return {
      averageHoursToShip:
        row?.averageHoursToShip !== null &&
        row?.averageHoursToShip !== undefined
          ? Number(row.averageHoursToShip)
          : null,
      averageHoursToDeliver:
        row?.averageHoursToDeliver !== null &&
        row?.averageHoursToDeliver !== undefined
          ? Number(row.averageHoursToDeliver)
          : null,
    };
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
    return groups;
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
