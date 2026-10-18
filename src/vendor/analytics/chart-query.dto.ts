import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsTimeZone, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /vendor/analytics/chart.
 * Validates days (integer 1-365) and timezone (valid IANA timezone).
 */
export class ChartQueryDto {
  @ApiPropertyOptional({
    description: 'Number of days of data to retrieve (1-365).',
    minimum: 1,
    maximum: 365,
    default: 30,
    example: 30,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;

  @ApiPropertyOptional({
    description: 'IANA timezone for date grouping.',
    default: 'UTC',
    example: 'UTC',
  })
  @IsOptional()
  @IsString()
  @IsTimeZone()
  timezone: string = 'UTC';
}
