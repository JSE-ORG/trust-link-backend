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
    const endDateKey = this.formatDateInTimezone(endDate, timezone);
    const startDateKey = this.addCalendarDays(endDateKey, -(days - 1));
    const startDate = this.localMidnightInTimezone(startDateKey, timezone);

    // Use repository for database-level aggregation with proper timezone handling.
    const aggregationResult = await this.repository.aggregateDailyVolume(
      vendorAddress,
      startDate,
      endDate,
      timezone,
    );

    // Convert aggregation results to DailyVolumeData format
    const dailyMap = new Map<string, DailyVolumeDataDto>();

    // A Postgres `date` column comes back from the driver as a JS Date, not
    // a string, so it is normalised before being used as a map key —
    // fillDateGaps looks the key up as 'YYYY-MM-DD' and would otherwise never
    // match, silently reporting every day as zero.
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

    // Fill gaps for days with zero transactions
    const filledData = this.fillDateGaps(dailyMap, startDateKey, endDateKey);

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
   * Fills gaps in the date range with zero-transaction entries
   * Ensures consistent time-series data even for days with no activity
   */
  private fillDateGaps(
    dailyMap: Map<string, DailyVolumeDataDto>,
    startDateKey: string,
    endDateKey: string,
  ): DailyVolumeDataDto[] {
    const result: DailyVolumeDataDto[] = [];
    let dateKey = startDateKey;
    while (dateKey <= endDateKey) {
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

      dateKey = this.addCalendarDays(dateKey, 1);
    }

    return result;
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
   * Includes conversion metrics and channel preferences.
   *
   * #843 — Counts and sums are aggregated by the database with a single
   * `groupBy` on `state`, and the per-state sums are added as decimals.
   *
   * The previous implementation ran `findMany` over every escrow the vendor
   * has ever created and counted and summed the rows in a JavaScript loop. The
   * result set grew without bound with vendor history while the response
   * stayed a fixed handful of numbers, so the cost of a dashboard page scaled
   * with total escrows rather than with the number of states. Each amount was
   * also pulled through `Number()` before being added: `amount` is
   * `Decimal(18, 8)`, so converting to a double first and then summing loses
   * precision below 2^53 minor units — exactly the small-vendor case where
   * the total is supposed to be exact.
   *
   * `groupBy` narrows the transfer to one row per state and lets Postgres sum
   * the `numeric` column exactly.
   */
  async getTransactionStats(
    vendorAddress: string,
  ): Promise<AnalyticsStatsResponse> {
    // One row per state, with the count and the exact `numeric` sum for that
    // state. Uses the composite index on (vendorAddress, state).
    const groups = await this.repository.getEscrowStateGroups(vendorAddress);

    // Active states: CREATED, FUNDED, SHIPPED, DELIVERED
    const activeStates = new Set(['CREATED', 'FUNDED', 'SHIPPED', 'DELIVERED']);

    // Decimal accumulators, not floats. The running totals stay exact for the
    // whole loop and are converted to `number` once, at the end, for the
    // response.
    let totalVolume = decimalZero();
    let activeVolume = decimalZero();
    let totalTransactions = 0;
    let activeTransactions = 0;
    let completedTransactions = 0;
    let disputedTransactions = 0;
    let cancelledTransactions = 0;

    for (const group of groups) {
      // Narrowed explicitly: `groupBy` infers a wide union here, and a null
      // `_sum` is what an empty state group returns.
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

    // The response contract is numeric, so the exact decimals are converted
    // once here rather than being carried as floats through the additions.
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
    };

    // Calculate rates
    if (stats.totalTransactions > 0) {
      stats.completionRate =
        (stats.completedTransactions / stats.totalTransactions) * 100;
      stats.disputeRate =
        (stats.disputedTransactions / stats.totalTransactions) * 100;
      // Divided in decimal so the average of an exact total is not itself
      // rounded twice; converted to a number only for the response.
      stats.averageTransactionValue = decimalToNumber(
        totalVolume.div(stats.totalTransactions),
      );
    }

    // Fetch vendor tracking settings for channel preferences (defaults to platform defaults)
    const notificationChannels =
      (await this.repository.findNotificationChannels(vendorAddress)) ??
      DEFAULT_NOTIFICATION_CHANNELS;

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

    // Reconcile the UTC guess against the local wall-clock representation.
    // This handles both positive and negative UTC offsets and DST changes.
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
