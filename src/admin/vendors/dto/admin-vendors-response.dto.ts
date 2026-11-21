import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminVendorItemDto {
  @ApiProperty({
    description: 'Vendor Stellar public address.',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  address!: string;

  @ApiPropertyOptional({
    description: 'Vendor registered business name.',
    example: 'Acme Corp',
  })
  businessName!: string | null;

  @ApiProperty({
    description: 'Timestamp when vendor profile was created.',
    example: '2026-01-01T00:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Total number of escrows created for this vendor.',
    example: 10,
  })
  escrowCount!: number;

  @ApiProperty({
    description: 'Number of completed/released escrows.',
    example: 8,
  })
  completedCount!: number;

  @ApiProperty({
    description: 'Number of disputed escrows.',
    example: 1,
  })
  disputedCount!: number;
}

export class AdminVendorsPaginatedResponseDto {
  @ApiProperty({ type: [AdminVendorItemDto] })
  data!: AdminVendorItemDto[];

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
