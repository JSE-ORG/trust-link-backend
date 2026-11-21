import { ApiProperty } from '@nestjs/swagger';
import { EscrowSummaryDto } from './escrow-summary.dto';

/**
 * Paginated wrapper returned by GET /vendor/escrows. Contains the single
 * page of escrow summaries plus the total record count, requested page
 * number, page size, total pages, and next-page indicator so clients can render pagination controls.
 *
 * The data array holds the compact EscrowSummaryDto representation rather
 * than the full escrow record, matching what the service returns.
 */
export class VendorEscrowsPaginatedResponseDto {
  @ApiProperty({
    description:
      'The escrow summary records for the requested page. Compact EscrowSummaryDto representation (no sensitive internal identifiers).',
    type: [EscrowSummaryDto],
  })
  data!: EscrowSummaryDto[];

  @ApiProperty({
    description:
      'Total number of escrows matching the filter, before page/limit were applied.',
    example: 127,
  })
  total!: number;

  @ApiProperty({
    description: '1-based page number this response represents.',
    example: 1,
    minimum: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Maximum number of records returned per page.',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total number of pages available.',
    example: 7,
    minimum: 0,
  })
  totalPages!: number;

  @ApiProperty({
    description: 'Whether there is a subsequent page available.',
    example: true,
  })
  hasNextPage!: boolean;
}
