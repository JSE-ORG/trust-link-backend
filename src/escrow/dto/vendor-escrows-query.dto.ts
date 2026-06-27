import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EscrowStateEnum } from '../../common/enums/escrow-state.enum';

/**
 * Query parameters for GET /vendor/escrows. Supports filtering by state,
 * sorting by date or amount, and cursor-based pagination with page and
 * limit parameters.
 */
export class VendorEscrowsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter escrows by lifecycle state.',
    enum: EscrowStateEnum,
    example: EscrowStateEnum.SHIPPED,
  })
  @IsOptional()
  @IsEnum(EscrowStateEnum, {
    message: `state must be one of: ${Object.values(EscrowStateEnum).join(', ')}`,
  })
  state?: EscrowStateEnum;

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
