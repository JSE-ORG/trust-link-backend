import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EscrowStateEnum } from '../../../common/enums/escrow-state.enum';

/** Splits a comma-separated query value into a trimmed, non-empty list; a single value behaves as before. */
function splitCommaList({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export class AdminEscrowsQueryDto {
  @ApiPropertyOptional({
    enum: EscrowStateEnum,
    description:
      'One or more lifecycle states (comma-separated, e.g. "FUNDED,SHIPPED"). A single value behaves as before.',
    example: 'FUNDED,SHIPPED',
  })
  @IsOptional()
  @Transform(splitCommaList)
  @IsEnum(EscrowStateEnum, {
    each: true,
    message: `state must be one of: ${Object.values(EscrowStateEnum).join(', ')}`,
  })
  state?: EscrowStateEnum | EscrowStateEnum[];

  @ApiPropertyOptional({
    maxLength: 64,
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vendorAddress?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  buyerAddress?: string;

  @ApiPropertyOptional({
    description: 'Earliest createdAt, inclusive (ISO 8601).',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Latest createdAt, inclusive (ISO 8601). A date without a time covers the whole day.',
    example: '2026-12-31',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ maxLength: 200, example: 'SKU-CAM-A7IV-001' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: ['date', 'amount'], example: 'date' })
  @IsOptional()
  @IsEnum(['date', 'amount'])
  sort?: 'date' | 'amount';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], example: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1_000_000,
    default: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20, example: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
