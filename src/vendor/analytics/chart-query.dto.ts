import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsTimeZone,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /vendor/analytics/chart.
 * Validates days (integer 1-365), timezone (valid IANA timezone), and interval (day|week|month).
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

  @ApiPropertyOptional({
    description: 'Aggregation interval for grouping: day, week, or month.',
    enum: ['day', 'week', 'month'],
    default: 'day',
    example: 'day',
  })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  interval: 'day' | 'week' | 'month' = 'day';
}
