import { ApiProperty } from '@nestjs/swagger';
import { DisputeResponseDto } from '../../escrow/dto/dispute-response.dto';

/**
 * Paginated wrapper for the admin disputes listing at GET /admin/disputes.
 * Includes a single page of disputes (DisputeResponseDto), total count,
 * current page number, and page size so the admin UI can render paging
 * controls.
 */
export class AdminDisputesPaginatedResponseDto {
  @ApiProperty({
    description:
      'Dispute records for this page, with full escrow and reason context.',
    type: [DisputeResponseDto],
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
}
