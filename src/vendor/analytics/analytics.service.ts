import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChartDataResponse, DailyVolumeDataDto } from './analytics.dto';
import {
  AnalyticsStatsResponse,
  TransactionStatsDto,
  ChannelMetricsDto,
} from './analytics-stats.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves daily transaction volume data for a vendor.
   * Uses database-level aggregation with raw SQL for optimal performance on large datasets.
   * Handles timezone boundaries correctly and fills gaps for days with zero transactions.
   * Returns time-series data grouped by date with aggregated metrics.
   */
  async getDailyVolumeChart(
    vendorAddress: string,
    days: number = 30,
    timezone: string = 'UTC',
  ): Promise<ChartDataResponse> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setUTCHours(0, 0, 0, 0);

    // Use raw SQL for database-level aggregation with proper timezone handling.
    //
    // Two things here are load-bearing:
    //
    // 1. `createdAt` is `timestamp without time zone` holding a UTC instant.
    //    A single `AT TIME ZONE ${timezone}` would read that naive value as
    //    *local* wall time and convert the wrong way, shifting the bucket by
    //    the server's UTC offset and putting rows near midnight on the wrong
    //    day. Attaching UTC first, then converting, is what actually yields
    //    the calendar day in the caller's timezone. This is invisible on a
    //    server running UTC (such as CI) and wrong everywhere else.
    //
    // 2. GROUP BY / ORDER BY reference the select item by ordinal rather than
    //    repeating the expression: `${timezone}` is bound as a query
    //    parameter, so a repeated expression arrives as a *different*
    //    placeholder ($1 vs $3) and Postgres cannot match it to the grouped
    //    column, failing with `column "Escrow.createdAt" must appear in the
    //    GROUP BY clause`.
    const aggregationResult = await this.prisma.$queryRaw<
      Array<{
        date: string;
        totalVolume: number;
        transactionCount: number;
        completedCount: number;
        disputedCount: number;
      }>
    >`
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

    // Convert aggregation results to DailyVolumeData format
    const dailyMap = new Map<string, DailyVolumeDataDto>();

    type AggRow = {
      // A Postgres `date` column comes back from the driver as a JS Date, not
      // a string, so this is normalised below before being used as a map key —
      // fillDateGaps looks the key up as 'YYYY-MM-DD' and would otherwise never
      // match, silently reporting every day as zero.
      date: string | Date;
      totalVolume: number | string;
      transactionCount: number | string;
      completedCount: number | string;
      disputedCount: number | string;
    };
    for (const row of aggregationResult) {
      const r = row as AggRow;
      const dateKey = this.toDateKey(r.date);
      const totalVolume = Number(r.totalVolume);
      const transactionCount = Number(r.transactionCount);
      const completedCount = Number(r.completedCount);
      const disputedCount = Number(r.disputedCount);

      dailyMap.set(dateKey, {
        date: dateKey,
        totalVolume,
        transactionCount,
        completedCount,
        disputedCount,
        averageTransactionValue:
          transactionCount > 0 ? totalVolume / transactionCount : 0,
      });
    }

    // Fill gaps for days with zero transactions
    const filledData = this.fillDateGaps(
      dailyMap,
      startDate,
      endDate,
      timezone,
    );

    // Sort by date ascending
    const sortedData = filledData.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate summary statistics
    const totalVolume = sortedData.reduce((sum, d) => sum + d.totalVolume, 0);
    const totalTransactions = sortedData.reduce(
      (sum, d) => sum + d.transactionCount,
      0,
    );
    const averageDaily =
      sortedData.length > 0 ? totalVolume / sortedData.length : 0;

    return {
      data: sortedData,
      period: {
        startDate: this.formatDate(startDate),
        endDate: this.formatDate(endDate),
      },
      summary: {
        totalVolume,
        totalTransactions,
        averageDaily,
      },
    };
  }

  /**
   * Fills gaps in the date range with zero-transaction entries
   * Ensures consistent time-series data even for days with no activity
   */
  private fillDateGaps(
    dailyMap: Map<string, DailyVolumeDataDto>,
    startDate: Date,
    endDate: Date,
    timezone: string = 'UTC',
  ): DailyVolumeDataDto[] {
    const result: DailyVolumeDataDto[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateKey = this.formatDateInTimezone(currentDate, timezone);

      if (dailyMap.has(dateKey)) {
        result.push(dailyMap.get(dateKey)!);
      } else {
        result.push({
          date: dateKey,
          totalVolume: 0,
          transactionCount: 0,
          completedCount: 0,
          disputedCount: 0,
          averageTransactionValue: 0,
        });
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  }

  /**
   * Formats a Date object to ISO date string (YYYY-MM-DD) in a specific timezone
   */
  private formatDateInTimezone(date: Date, timezone: string): string {
    return date.toLocaleDateString('en-CA', { timeZone: timezone });
  }

  /**
   * Normalises a `date` column from a raw query into a 'YYYY-MM-DD' key.
   *
   * The aggregation already casts to the caller's timezone in SQL, so the
   * value returned is the calendar day itself. It is read in UTC rather than
   * re-formatted in the caller's timezone, which would shift it by a day.
   */
  private toDateKey(value: string | Date): string {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return String(value).slice(0, 10);
  }

  /**
   * Retrieves overall transaction statistics for a vendor.
   * Uses fast query paths with composite indexes on (vendorAddress, state).
   * Includes conversion metrics and channel preferences.
   */
  async getTransactionStats(
    vendorAddress: string,
  ): Promise<AnalyticsStatsResponse> {
    // Query all escrows for the vendor, grouped by state
    // Uses index on (vendorAddress, state) for fast filtering
    const escrows = await this.prisma.escrow.findMany({
      where: {
        vendorAddress,
      },
      select: {
        id: true,
        amount: true,
        state: true,
      },
    });

    // Calculate transaction statistics
    const stats: TransactionStatsDto = {
      totalVolume: 0,
      activeVolume: 0,
      totalTransactions: escrows.length,
      activeTransactions: 0,
      completedTransactions: 0,
      completionRate: 0,
      disputedTransactions: 0,
      disputeRate: 0,
      averageTransactionValue: 0,
      cancelledTransactions: 0,
    };

    // Active states: CREATED, FUNDED, SHIPPED, DELIVERED
    const activeStates = ['CREATED', 'FUNDED', 'SHIPPED', 'DELIVERED'];

    for (const escrow of escrows) {
      const amount = Number(escrow.amount);
      const state = (escrow as { state: string }).state;
      stats.totalVolume += amount;

      if (activeStates.includes(state)) {
        stats.activeVolume += amount;
        stats.activeTransactions += 1;
      }

      if (state === 'COMPLETED' || state === 'RELEASED') {
        stats.completedTransactions += 1;
      }

      if (state === 'DISPUTED') {
        stats.disputedTransactions += 1;
      }

      if (state === 'CANCELLED') {
        stats.cancelledTransactions += 1;
      }
    }

    // Calculate rates
    if (stats.totalTransactions > 0) {
      stats.completionRate =
        (stats.completedTransactions / stats.totalTransactions) * 100;
      stats.disputeRate =
        (stats.disputedTransactions / stats.totalTransactions) * 100;
      stats.averageTransactionValue =
        stats.totalVolume / stats.totalTransactions;
    }

    // Fetch vendor tracking settings for channel preferences
    const trackingSettings =
      await this.prisma.vendorTrackingSettings.findUnique({
        where: { vendorAddress },
        select: {
          notificationChannels: true,
        },
      });

    const notificationChannels = trackingSettings?.notificationChannels ?? [];

    const channels: ChannelMetricsDto = {
      email: {
        notificationsEnabled: notificationChannels.includes('EMAIL'),
      },
      sms: {
        notificationsEnabled: notificationChannels.includes('SMS'),
      },
    };

    return {
      stats,
      channels,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Formats a Date object to ISO date string (YYYY-MM-DD)
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
