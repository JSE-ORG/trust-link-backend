import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import type { EscrowState } from '../../prisma/prisma.service';

export class VendorEscrowsQueryDto {
  @IsOptional()
  @IsIn(['FUNDED', 'SHIPPED', 'DELIVERED', 'RELEASED', 'COMPLETED', 'REFUNDED'])
  state?: EscrowState;

  @IsOptional()
  @IsIn(['date', 'amount'])
  sort?: 'date' | 'amount' = 'date';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
