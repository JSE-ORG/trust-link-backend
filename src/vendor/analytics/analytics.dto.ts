import { ApiProperty } from '@nestjs/swagger';

/**
 * Daily transaction volume data point for chart rendering, including
 * total volume, transaction counts, and average transaction value.
 */
export class DailyVolumeDataDto {
  @ApiProperty({
    description:
      'Calendar date this data point represents, ISO format (YYYY-MM-DD).',
    example: '2026-05-01',
  })
  date!: string;

  @ApiProperty({
    description: 'Total USDC (or base currency) escrow volume for the day.',
    example: 48950.75,
  })
  totalVolume!: number;

  @ApiProperty({
    description:
      'Total number of transactions (escrows) initiated on this day.',
    example: 18,
  })
  transactionCount!: number;

  @ApiProperty({
    description:
      'Number of transactions on this day that reached a completed state.',
    example: 15,
  })
  completedCount!: number;

  @ApiProperty({
    description:
      'Number of transactions on this day that have an open or resolved dispute.',
    example: 1,
  })
  disputedCount!: number;

  @ApiProperty({
    description:
      'Average transaction value on this day, totalVolume / transactionCount.',
    example: 2719.49,
  })
  averageTransactionValue!: number;
}

/**
 * Response shape for GET /vendor/analytics/chart containing daily
 * volume data for the requested time period with summary totals.
 */
export class ChartDataResponse {
  @ApiProperty({
    description: 'Daily volume data points for the requested date range.',
    type: [DailyVolumeDataDto],
  })
  data!: DailyVolumeDataDto[];

  @ApiProperty({
    description: 'Date range this response covers.',
    type: 'object',
    properties: {
      startDate: {
        type: 'string',
        description: 'First day of the range (inclusive), ISO format.',
        example: '2026-04-01',
      },
      endDate: {
        type: 'string',
        description: 'Last day of the range (inclusive), ISO format.',
        example: '2026-05-01',
      },
    },
  })
  period!: {
    startDate: string;
    endDate: string;
  };

  @ApiProperty({
    description: 'Summary aggregates rolled up across the full period.',
    type: 'object',
    properties: {
      totalVolume: {
        type: 'number',
        description: 'Sum of daily transaction volumes for the entire period.',
        example: 948320.5,
      },
      totalTransactions: {
        type: 'number',
        description: 'Sum of daily transaction counts for the entire period.',
        example: 347,
      },
      averageDaily: {
        type: 'number',
        description: 'Average daily totalVolume across the range.',
        example: 30591.0,
      },
    },
  })
  summary!: {
    totalVolume: number;
    totalTransactions: number;
    averageDaily: number;
  };
}
