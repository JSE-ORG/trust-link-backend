import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  Max,
  Min,
  IsString,
  IsDateString,
} from 'class-validator';

export class AdminAuditLogQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1_000_000,
    default: 1,
    description: 'Page number to return.',
    example: 1,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Number of audit log entries to return per page.',
    example: 20,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by action type',
    example: 'DISPUTE_RESOLVED',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    description: 'Filter by entity type',
    example: 'dispute',
  })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({
    description: 'Filter by entity ID',
    example: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({
    description: 'Filter by admin address',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsOptional()
  @IsString()
  adminAddress?: string;

  @ApiPropertyOptional({
    description: 'Filter by date from (ISO 8601)',
    example: '2026-05-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter by date to (ISO 8601)',
    example: '2026-05-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
