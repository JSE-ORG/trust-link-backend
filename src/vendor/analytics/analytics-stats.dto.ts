import { ApiProperty } from '@nestjs/swagger';

/**
 * Aggregate transaction statistics for the authenticated vendor,
 * including volume, counts, rates, and averages.
 */
export class TransactionStatsDto {
  @ApiProperty({
    description: 'Total transaction amount in the base currency across all escrows ever created by this vendor.',
    example: 1248950.5,
  })
  totalVolume!: number;

  @ApiProperty({
    description: 'Sum of amounts currently held in active (non-terminal) escrows.',
    example: 87300.25,
  })
  activeVolume!: number;

  @ApiProperty({
    description: 'Total number of escrows ever created by this vendor.',
    example: 487,
  })
  totalTransactions!: number;

  @ApiProperty({
    description:
      'Count of escrows currently in a non-terminal state (FUNDED, SHIPPED, DELIVERED, DISPUTED).',
    example: 32,
  })
  activeTransactions!: number;

  @ApiProperty({
    description: 'Count of escrows that reached COMPLETED or RELEASED.',
    example: 435,
  })
  completedTransactions!: number;

  @ApiProperty({
    description: 'Percentage of total escrows that completed (0-100).',
    example: 89.32,
  })
  completionRate!: number;

  @ApiProperty({
    description: 'Count of escrows that ever entered the DISPUTED state.',
    example: 11,
  })
  disputedTransactions!: number;

  @ApiProperty({
    description: 'Percentage of total escrows disputed (0-100).',
    example: 2.26,
  })
  disputeRate!: number;

  @ApiProperty({
    description: 'Average escrow amount — totalVolume / totalTransactions.',
    example: 2564.58,
  })
  averageTransactionValue!: number;

  @ApiProperty({
    description: 'Count of escrows cancelled before funding or at the buyer/vendor request.',
    example: 9,
  })
  cancelledTransactions!: number;
}

/**
 * Per-channel notification metrics returned alongside transaction
 * stats so a vendor UI can show which notification avenues are live.
 */
export class ChannelMetricsDto {
  @ApiProperty({
    description: 'Email channel metrics.',
    type: 'object',
    properties: {
      notificationsEnabled: {
        type: 'boolean',
        description: 'True if the vendor has opted in to email notifications.',
        example: true,
      },
    },
  })
  email!: {
    notificationsEnabled: boolean;
  };

  @ApiProperty({
    description: 'SMS channel metrics.',
    type: 'object',
    properties: {
      notificationsEnabled: {
        type: 'boolean',
        description: 'True if the vendor has opted in to SMS notifications.',
        example: false,
      },
    },
  })
  sms!: {
    notificationsEnabled: boolean;
  };
}

/**
 * Response shape for GET /vendor/analytics containing overall
 * transaction statistics and notification channel metrics.
 */
export class AnalyticsStatsResponse {
  @ApiProperty({
    description: 'Rolled-up transaction statistics for the authenticated vendor.',
  })
  stats!: TransactionStatsDto;

  @ApiProperty({
    description: 'Notification channel availability and configuration.',
  })
  channels!: ChannelMetricsDto;

  @ApiProperty({
    description:
      'ISO-8601 timestamp the stats were last refreshed. The analytics service caches aggregations and this field tells a client how stale they are.',
    example: '2026-05-28T10:17:42.000Z',
  })
  lastUpdated!: string;
}
