import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicVendorProfileDto {
  @ApiPropertyOptional({
    description: 'Public business name of the vendor.',
    example: 'Acme Supplies',
  })
  businessName!: string | null;

  @ApiPropertyOptional({
    description: 'Public business description.',
    example: 'Wholesale electronics and gadgets.',
  })
  description!: string | null;

  @ApiProperty({
    description: 'Timestamp when vendor registered (member since).',
    example: '2026-01-01T00:00:00.000Z',
  })
  memberSince!: Date;

  @ApiProperty({
    description: 'Total number of completed/released escrows.',
    example: 42,
  })
  completedEscrows!: number;

  @ApiProperty({
    description: 'Percentage of total escrows disputed (0-100).',
    example: 2.5,
  })
  disputeRate!: number;
}
