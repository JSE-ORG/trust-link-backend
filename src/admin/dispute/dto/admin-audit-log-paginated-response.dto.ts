import { ApiProperty } from '@nestjs/swagger';
import { AuditLogEntryDto } from '../../stats/dto/audit-log-entry.dto';

/**
 * Paginated wrapper for the admin audit log listing at GET /admin/audit-log.
 * Includes a single page of audit log entries, total count,
 * current page number, page size, total pages, and next-page indicator.
 */
export class AdminAuditLogPaginatedResponseDto {
  @ApiProperty({
    description: 'Audit log records for this page.',
    type: [AuditLogEntryDto],
    example: [
      {
        timestamp: '2026-05-27T09:14:00.000Z',
        adminAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        action: 'DISPUTE_RESOLVED',
        entityType: 'dispute',
        entityId: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
        details: { resolution: 'REFUND' },
      },
    ],
  })
  data!: AuditLogEntryDto[];

  @ApiProperty({
    description:
      'Total audit log records matching filters (ignoring pagination).',
    example: 143,
  })
  total!: number;

  @ApiProperty({
    description: '1-based page number this response represents.',
    example: 1,
    minimum: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Maximum audit log records returned per page.',
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
