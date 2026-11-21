import { Type } from 'class-transformer';
import {
  IsDateString,
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
 * `from`/`to` are an alternative to `days` for picking an explicit, possibly
 * past, date range — the two are mutually exclusive (checked in the controller,
 * since class-validator alone can't express "exactly one of these").
 */
export class ChartQueryDto {
  @ApiPropertyOptional({
    description:
      'Number of days of data to retrieve (1-365). Mutually exclusive with from/to.',
    minimum: 1,
    maximum: 365,
    example: 30,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @ApiPropertyOptional({
    description:
      'Start of an explicit date range (in `timezone`), inclusive. Mutually exclusive with days; requires `to`.',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description:
      'End of an explicit date range (in `timezone`), inclusive. Mutually exclusive with days; requires `from`. The range may span at most 366 days.',
    example: '2026-09-30',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

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
