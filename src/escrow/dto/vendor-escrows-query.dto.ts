import { Type } from 'class-transformer';
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

/**
 * Query parameters for GET /vendor/escrows and GET /buyer/escrows.
 * #1149: adds from, to, buyerAddress and q (text search) filters.
 */
export class VendorEscrowsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by lifecycle state.',
    enum: EscrowStateEnum,
  })
  @IsOptional()
  @IsEnum(EscrowStateEnum, {
    message: `state must be one of: ${Object.values(EscrowStateEnum).join(', ')}`,
  })
  state?: EscrowStateEnum;

  /** #1149 — createdAt range */
  @ApiPropertyOptional({
    description: 'Earliest createdAt (ISO 8601).',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Latest createdAt (ISO 8601).',
    example: '2026-12-31',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  /** #1149 — buyer address filter */
  @ApiPropertyOptional({
    description: 'Filter by buyer Stellar address.',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  buyerAddress?: string;

  /** #1149 — case-insensitive text search on itemName / itemRef */
  @ApiPropertyOptional({
    description: 'Case-insensitive search on itemName or itemRef.',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @ApiPropertyOptional({
    description: 'Sort field.',
    enum: ['date', 'amount'],
    default: 'date',
  })
  @IsOptional()
  @IsIn(['date', 'amount'])
  sort?: 'date' | 'amount' = 'date';

  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    description: 'Page number (1-based).',
    minimum: 1,
    default: 1,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Results per page.',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
