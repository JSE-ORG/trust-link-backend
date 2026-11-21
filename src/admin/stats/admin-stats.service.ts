import { Injectable } from '@nestjs/common';
import { DisputeStatusEnum } from '../../common/enums/escrow-state.enum';
import { AdminStatsRepository } from './admin-stats.repository';
import { AdminStatsDto } from './dto/admin-stats.dto';
import { AdminStatsChartBucketDto } from './dto/admin-stats-chart-bucket.dto';

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
    const [totals, totalDisputes, openDisputes] = await Promise.all([
      this.stats.collectTotals(),
      this.stats.countDisputes(),
      this.stats.countOpenDisputes(OPEN_DISPUTE_STATUSES),
    ]);

    const totalEscrows = totals.stateGroups.reduce(
      (sum, group) => sum + group._count,
      0,
    );
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
      volumeByCurrency: totals.volumeByCurrency,
      escrowsByState,
      uniqueVendors: totals.uniqueVendors,
      uniqueBuyers: totals.uniqueBuyers,
      totalDisputes,
      openDisputes,
      averageEscrowAmount,
    };
  }

  /**
   * Retrieves daily platform statistics (escrows created, volume, completed, disputed)
   * for the given number of days (1-365, default 30).
   * Gaps for days without escrows are filled with zero values.
   */
  async getChart(days: number = 30): Promise<AdminStatsChartBucketDto[]> {
    const clampedDays = Math.min(365, Math.max(1, Math.floor(days || 30)));
    const now = new Date();
    const endYear = now.getUTCFullYear();
    const endMonth = now.getUTCMonth();
    const endDay = now.getUTCDate();

    const todayUtcMidnight = new Date(
      Date.UTC(endYear, endMonth, endDay, 0, 0, 0, 0),
    );
    const endDate = new Date(
      Date.UTC(endYear, endMonth, endDay, 23, 59, 59, 999),
    );
    const startDate = new Date(
      Date.UTC(endYear, endMonth, endDay - (clampedDays - 1), 0, 0, 0, 0),
    );

    const rawRows = await this.stats.aggregateDailyStats(startDate, endDate);

    const map = new Map<
      string,
      {
        escrowsCreated: number;
        volume: number;
        completed: number;
        disputed: number;
      }
    >();

    for (const row of rawRows) {
      const dateKey = this.toDateKey(row.date);
      map.set(dateKey, {
        escrowsCreated: Number(row.escrowsCreated),
        volume: Number(row.volume),
        completed: Number(row.completed),
        disputed: Number(row.disputed),
      });
    }

    const buckets: AdminStatsChartBucketDto[] = [];
    const current = new Date(startDate);
    while (current <= todayUtcMidnight) {
      const dateKey = current.toISOString().slice(0, 10);
      const row = map.get(dateKey);
      buckets.push({
        date: dateKey,
        escrowsCreated: row ? row.escrowsCreated : 0,
        volume: row ? row.volume : 0,
        completed: row ? row.completed : 0,
        disputed: row ? row.disputed : 0,
      });
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return buckets;
  }

  private toDateKey(value: string | Date): string {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    const str = String(value);
    if (str.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.slice(0, 10);
    }
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return str;
  }
}
