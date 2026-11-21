import { ApiProperty } from '@nestjs/swagger';
import { DisputeResponseDto } from '../../../escrow/dto/dispute-response.dto';

/**
 * Paginated wrapper for the admin disputes listing at GET /admin/disputes.
 * Includes a single page of disputes (DisputeResponseDto), total count,
 * current page number, page size, total pages, and next-page indicator so the admin UI can render paging controls.
 */
export class AdminDisputesPaginatedResponseDto {
  @ApiProperty({
    description:
      'Dispute records for this page, with full escrow and reason context.',
    type: [DisputeResponseDto],
    example: [
      {
        id: '2b8b9e44-bb2e-4e9b-9c31-0a7d9cf4a788',
        escrowId: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
        reason: 'DAMAGED_ITEM',
        status: 'UNDER_REVIEW',
      },
    ],
  })
  data!: DisputeResponseDto[];

  @ApiProperty({
    description:
      'Total disputes matching the current status filter (ignoring pagination).',
    example: 143,
  })
  total!: number;

  @ApiProperty({
    description: '1-based page number this response represents.',
    example: 2,
    minimum: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Maximum dispute records returned per page.',
    example: 20,
    minimum: 1,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total number of pages available.',
    example: 8,
    minimum: 0,
  })
  totalPages!: number;

  @ApiProperty({
    description: 'Whether there is a subsequent page available.',
    example: true,
  })
  hasNextPage!: boolean;
}
