import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EscrowStateEnum } from '../../common/enums/escrow-state.enum';

/** Splits a comma-separated query value into a trimmed, non-empty list; a single value behaves as before. */
function splitCommaList({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Query parameters for GET /vendor/escrows, GET /vendor/escrows/export and
 * GET /buyer/escrows. Supports filtering by state, creation date, buyer and
 * search text, sorting by date or amount, and page-based pagination.
 */
export class VendorEscrowsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by one or more lifecycle states (comma-separated, e.g. "FUNDED,SHIPPED"). A single value behaves as before.',
    enum: EscrowStateEnum,
    example: EscrowStateEnum.SHIPPED,
  })
  @IsOptional()
  @Transform(splitCommaList)
  @IsEnum(EscrowStateEnum, {
    each: true,
    message: `state must be one of: ${Object.values(EscrowStateEnum).join(', ')}`,
  })
  state?: EscrowStateEnum | EscrowStateEnum[];

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

  @ApiPropertyOptional({
    description:
      'Filter by buyer Stellar address. Ignored on GET /buyer/escrows, which always uses the caller.',
    maxLength: 64,
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  buyerAddress?: string;

  @ApiPropertyOptional({
    description:
      'Filter by vendor Stellar address. Only meaningful on GET /buyer/escrows; ignored on vendor routes, which always scope to the caller.',
    maxLength: 64,
    example: 'GAIGZHHWK3REZQPLQX5DNFRYDUPFGG6VY4PSWSL53N2OY3Z3H3CE5TMK',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vendorAddress?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive search on itemName or itemRef.',
    maxLength: 128,
    example: 'Sony A7 IV',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @ApiPropertyOptional({
    description: 'Field to sort the results by.',
    enum: ['date', 'amount'],
    default: 'date',
    example: 'date',
  })
  @IsOptional()
  @IsIn(['date', 'amount'])
  sort?: 'date' | 'amount' = 'date';

  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: ['asc', 'desc'],
    default: 'desc',
    example: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    description: 'Page number (1-based) for pagination.',
    minimum: 1,
    default: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of escrows to return per page.',
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
