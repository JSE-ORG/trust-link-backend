import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /admin/stats/chart.
 * Validates days (integer 1-365, default 30).
 */
export class AdminChartQueryDto {
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
}
