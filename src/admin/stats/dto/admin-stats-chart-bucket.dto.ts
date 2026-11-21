import { ApiProperty } from '@nestjs/swagger';

/**
 * Daily aggregation bucket for platform stats chart.
 */
export class AdminStatsChartBucketDto {
  @ApiProperty({
    description: 'Calendar date represented by this bucket (YYYY-MM-DD).',
    example: '2026-11-20',
  })
  date!: string;

  @ApiProperty({
    description: 'Total number of escrows created on this day.',
    example: 12,
  })
  escrowsCreated!: number;

  @ApiProperty({
    description:
      'Total volume (in USDC / base currency) of escrows created on this day.',
    example: 15420.5,
  })
  volume!: number;

  @ApiProperty({
    description:
      'Number of escrows created on this day that are completed or released.',
    example: 10,
  })
  completed!: number;

  @ApiProperty({
    description:
      'Number of escrows created on this day that entered disputed state.',
    example: 1,
  })
  disputed!: number;
}
