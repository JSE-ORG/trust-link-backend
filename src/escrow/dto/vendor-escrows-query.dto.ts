import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { EscrowState } from '../../prisma/prisma.service';

export class VendorEscrowsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter escrows by lifecycle state.',
    enum: [
      'FUNDED',
      'SHIPPED',
      'DELIVERED',
      'RELEASED',
      'COMPLETED',
      'REFUNDED',
      'CANCELLED',
    ],
    example: 'SHIPPED',
  })
  @IsOptional()
  @IsIn([
    'FUNDED',
    'SHIPPED',
    'DELIVERED',
    'RELEASED',
    'COMPLETED',
    'REFUNDED',
    'CANCELLED',
  ])
  state?: EscrowState;

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
    default: 20,
    example: 20,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
