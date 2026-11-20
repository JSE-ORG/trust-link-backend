import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AnalyticsRepository } from './analytics.repository';
import { DEFAULT_NOTIFICATION_CHANNELS } from '../vendor.constants';
import { ChartDataResponse, DailyVolumeDataDto } from './analytics.dto';
import {
  AnalyticsStatsResponse,
  TransactionStatsDto,
  ChannelMetricsDto,
} from './analytics-stats.dto';

/**
 * Exact decimal arithmetic for the vendor stats aggregation (#843).
 *
 * `Escrow.amount` is `Decimal(18, 8)`. Reading each value with `Number()` and
 * adding it into a running float total silently loses precision: a double
 * carries 53 bits of mantissa, so an 8-decimal amount stops being exactly
 * representable past ~$0.90, and every addition can round. Summing in decimal
 * keeps the total exact; it is converted to a `number` once, at the end,
 * because the response contract is numeric.
 *
 * `null`/`undefined` is treated as absent rather than zero so a `groupBy` group
 * with no rows contributes nothing instead of throwing.
 */
function decimalZero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

/** Adds a possibly-absent Prisma Decimal into an exact running total. */
function decimalAdd(
  total: Prisma.Decimal,
  value: Prisma.Decimal | number | null | undefined,
): Prisma.Decimal {
  if (value === null || value === undefined) {
    return total;
  }
  return total.plus(value);
}

/** Converts an exact total to a `number` for the response body. */
function decimalToNumber(value: Prisma.Decimal): number {
  return value.toNumber();
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}

  /**
   * Retrieves transaction volume data for a vendor.
   * Uses database-level aggregation with raw SQL for optimal performance on large datasets.
   * Handles timezone boundaries correctly, groups by interval (day, week, month), and fills gaps.
   * Returns time-series data grouped by date with aggregated metrics (issues #942, #1155).
   */
  async getDailyVolumeChart(
    vendorAddress: string,
    days: number = 30,
    timezone: string = 'UTC',
    interval: 'day' | 'week' | 'month' = 'day',
  ): Promise<ChartDataResponse> {
    const endDate = new Date();
    const endDateKey = this.formatDateInTimezone(endDate, timezone);
    const startDateKey = this.addCalendarDays(endDateKey, -(days - 1));
    const startDate = this.localMidnightInTimezone(startDateKey, timezone);

    // Use repository for database-level aggregation with proper timezone handling and interval.
    const aggregationResult = await this.repository.aggregateDailyVolume(
      vendorAddress,
      startDate,
      endDate,
      timezone,
      interval,
    );

    // Convert aggregation results to DailyVolumeData format
    const dailyMap = new Map<string, DailyVolumeDataDto>();

    for (const row of aggregationResult) {
      const r = row;
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

    // Fill gaps for intervals with zero transactions
    const filledData = this.fillDateGaps(
      dailyMap,
      startDateKey,
      endDateKey,
      interval,
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
        startDate: startDateKey,
        endDate: endDateKey,
      },
      summary: {
        totalVolume,
        totalTransactions,
        averageDaily,
      },
    };
  }

  /**
   * Fills gaps in the date range with zero-transaction entries for day, week, or month intervals.
   */
  private fillDateGaps(
    dailyMap: Map<string, DailyVolumeDataDto>,
    startDateKey: string,
    endDateKey: string,
    interval: 'day' | 'week' | 'month' = 'day',
  ): DailyVolumeDataDto[] {
    const result: DailyVolumeDataDto[] = [];

    if (interval === 'week') {
      const [year, month, day] = startDateKey.split('-').map(Number);
      const d = new Date(Date.UTC(year, month - 1, day));
      const dayOfWeek = d.getUTCDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      d.setUTCDate(d.getUTCDate() + diff);

      const [endYear, endMonth, endDay] = endDateKey.split('-').map(Number);
      const endD = new Date(Date.UTC(endYear, endMonth - 1, endDay));
      const endDayOfWeek = endD.getUTCDay();
      const endDiff = endDayOfWeek === 0 ? -6 : 1 - endDayOfWeek;
      endD.setUTCDate(endD.getUTCDate() + endDiff);
      const lastWeekKey = endD.toISOString().slice(0, 10);

      let dateKey = d.toISOString().slice(0, 10);
      while (dateKey <= lastWeekKey) {
        this.pushBucket(result, dailyMap, dateKey);
        const next = new Date(dateKey + 'T00:00:00Z');
        next.setUTCDate(next.getUTCDate() + 7);
        dateKey = next.toISOString().slice(0, 10);
      }
    } else if (interval === 'month') {
      let dateKey = startDateKey.slice(0, 7) + '-01';
      const endMonthKey = endDateKey.slice(0, 7) + '-01';

      while (dateKey <= endMonthKey) {
        this.pushBucket(result, dailyMap, dateKey);
        const [y, m] = dateKey.split('-').map(Number);
        const next = new Date(Date.UTC(y, m, 1));
        dateKey = next.toISOString().slice(0, 10);
      }
    } else {
      let dateKey = startDateKey;
      while (dateKey <= endDateKey) {
        this.pushBucket(result, dailyMap, dateKey);
        dateKey = this.addCalendarDays(dateKey, 1);
      }
    }

    return result;
  }

  private pushBucket(
    result: DailyVolumeDataDto[],
    dailyMap: Map<string, DailyVolumeDataDto>,
    dateKey: string,
  ): void {
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
  }

  /**
   * Formats a Date object to ISO date string (YYYY-MM-DD) in a specific timezone
   */
  private formatDateInTimezone(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = new Map(parts.map(({ type, value }) => [type, value]));
    return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
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
   * Includes conversion metrics, speed metrics, and channel preferences.
   *
   * #843 — Counts and sums are aggregated by the database with a single
   * `groupBy` on `state`, and the per-state sums are added as decimals.
   * Speed metrics are computed in SQL (issue #1154).
   */
  async getTransactionStats(
    vendorAddress: string,
  ): Promise<AnalyticsStatsResponse> {
    const [groups, speedStats, notificationChannels] = await Promise.all([
      this.repository.getEscrowStateGroups(vendorAddress),
      typeof this.repository.getAverageShippingAndDeliveryTimes === 'function'
        ? this.repository.getAverageShippingAndDeliveryTimes(vendorAddress)
        : Promise.resolve({
            averageHoursToShip: null,
            averageHoursToDeliver: null,
          }),
      this.repository.findNotificationChannels(vendorAddress),
    ]);

    // Active states: CREATED, FUNDED, SHIPPED, DELIVERED
    const activeStates = new Set(['CREATED', 'FUNDED', 'SHIPPED', 'DELIVERED']);

    let totalVolume = decimalZero();
    let activeVolume = decimalZero();
    let totalTransactions = 0;
    let activeTransactions = 0;
    let completedTransactions = 0;
    let disputedTransactions = 0;
    let cancelledTransactions = 0;

    for (const group of groups) {
      const { state, _count, _sum } = group;
      const count = Number(
        typeof _count === 'object' ? _count?._all : (_count ?? 0),
      );
      const sum = _sum?.amount ?? null;

      totalTransactions += count;
      totalVolume = decimalAdd(totalVolume, sum);

      if (activeStates.has(state)) {
        activeTransactions += count;
        activeVolume = decimalAdd(activeVolume, sum);
      }

      if (state === 'COMPLETED' || state === 'RELEASED') {
        completedTransactions += count;
      }

      if (state === 'DISPUTED') {
        disputedTransactions += count;
      }

      if (state === 'CANCELLED') {
        cancelledTransactions += count;
      }
    }

    const totalVolumeNumber = decimalToNumber(totalVolume);
    const activeVolumeNumber = decimalToNumber(activeVolume);

    const stats: TransactionStatsDto = {
      totalVolume: totalVolumeNumber,
      activeVolume: activeVolumeNumber,
      totalTransactions,
      activeTransactions,
      completedTransactions,
      completionRate: 0,
      disputedTransactions,
      disputeRate: 0,
      averageTransactionValue: 0,
      cancelledTransactions,
      averageHoursToShip: speedStats.averageHoursToShip,
      averageHoursToDeliver: speedStats.averageHoursToDeliver,
    };

    if (stats.totalTransactions > 0) {
      stats.completionRate =
        (stats.completedTransactions / stats.totalTransactions) * 100;
      stats.disputeRate =
        (stats.disputedTransactions / stats.totalTransactions) * 100;
      stats.averageTransactionValue = decimalToNumber(
        totalVolume.div(stats.totalTransactions),
      );
    }

    const activeChannels =
      notificationChannels ?? DEFAULT_NOTIFICATION_CHANNELS;

    const channels: ChannelMetricsDto = {
      email: {
        notificationsEnabled: activeChannels.includes('EMAIL'),
      },
      sms: {
        notificationsEnabled: activeChannels.includes('SMS'),
      },
    };

    return {
      stats,
      channels,
      lastUpdated: new Date().toISOString(),
    };
  }

  private addCalendarDays(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  /** Resolves the first instant at local midnight for a calendar date. */
  private localMidnightInTimezone(dateKey: string, timezone: string): Date {
    const [year, month, day] = dateKey.split('-').map(Number);
    const targetAsUtc = Date.UTC(year, month - 1, day);
    let candidate = targetAsUtc;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = new Map(
        formatter
          .formatToParts(new Date(candidate))
          .map(({ type, value }) => [type, Number(value)]),
      );
      const part = (
        name: keyof Intl.DateTimeFormatPartTypesRegistry,
      ): number => {
        const value = parts.get(name);
        if (value === undefined) {
          throw new Error(`Missing ${name} date part for timezone ${timezone}`);
        }
        return value;
      };
      const representedAsUtc = Date.UTC(
        part('year'),
        part('month') - 1,
        part('day'),
        part('hour'),
        part('minute'),
        part('second'),
      );
      const correction = targetAsUtc - representedAsUtc;
      candidate += correction;
      if (correction === 0) break;
    }
    return new Date(candidate);
  }
}
