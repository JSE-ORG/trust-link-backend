import { ApiProperty } from '@nestjs/swagger';

/** Escrow volume for one currency. */
export class CurrencyVolumeDto {
  @ApiProperty({ example: 'USDC' })
  currency!: string;

  @ApiProperty({ example: 2450.5 })
  total!: number;

  @ApiProperty({ example: 12 })
  count!: number;

  @ApiProperty({ example: 204.21 })
  average!: number;
}

/**
 * Response shape for GET /admin/stats containing platform-wide
 * aggregate statistics. Includes escrow counts by state, volume
 * metrics, vendor/buyer counts, and dispute information.
 */
export class AdminStatsDto {
  @ApiProperty({
    description: 'Total number of escrows ever created.',
    example: 1287,
  })
  totalEscrows!: number;

  @ApiProperty({
    description: 'Total value locked/settled across all escrows.',
    example: 3245900.5,
  })
  totalVolume!: number;

  @ApiProperty({
    description:
      'Total, count and average volume per currency. totalVolume and averageEscrowAmount still sum across currencies.',
    type: [CurrencyVolumeDto],
  })
  volumeByCurrency!: CurrencyVolumeDto[];

  @ApiProperty({
    description: 'Count of escrows grouped by their current state.',
    type: 'object',
    additionalProperties: { type: 'number' },
    example: {
      FUNDED: 42,
      SHIPPED: 18,
      DELIVERED: 9,
      COMPLETED: 1200,
      REFUNDED: 18,
    },
  })
  escrowsByState!: Record<string, number>;

  @ApiProperty({
    description: 'Number of distinct vendor addresses seen.',
    example: 215,
  })
  uniqueVendors!: number;

  @ApiProperty({
    description: 'Number of distinct buyer addresses seen.',
    example: 873,
  })
  uniqueBuyers!: number;

  @ApiProperty({
    description: 'Total number of disputes ever opened.',
    example: 34,
  })
  totalDisputes!: number;

  @ApiProperty({
    description: 'Number of disputes currently open/unresolved.',
    example: 5,
  })
  openDisputes!: number;

  @ApiProperty({
    description: 'Average escrow amount across all escrows.',
    example: 2521.3,
  })
  averageEscrowAmount!: number;
}
