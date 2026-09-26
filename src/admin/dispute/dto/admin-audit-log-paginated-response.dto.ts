import { ApiProperty } from '@nestjs/swagger';
import { AuditLogEntryDto } from '../../stats/dto/audit-log-entry.dto';

/**
 * Paginated wrapper for the admin audit log listing at GET /admin/audit-log.
 * Includes a single page of audit log entries, total count,
 * current page number, and page size.
 */
export class AdminAuditLogPaginatedResponseDto {
  @ApiProperty({
    description: 'Audit log records for this page.',
    type: [AuditLogEntryDto],
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
}
