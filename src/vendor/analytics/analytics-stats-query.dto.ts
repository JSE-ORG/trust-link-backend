import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/** Optional createdAt bounds for GET /vendor/analytics. */
export class AnalyticsStatsQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive createdAt lower bound (ISO 8601).', example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive createdAt upper bound (ISO 8601).', example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
