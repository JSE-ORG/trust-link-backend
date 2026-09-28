import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { FailedTransactionStatus } from '../dlq.types';

const FAILED_TRANSACTION_STATUSES = [
  'PENDING_REVIEW',
  'REPLAYED',
  'ABANDONED',
] as const satisfies readonly FailedTransactionStatus[];

export class ListFailedTransactionsQueryDto {
  @ApiPropertyOptional({ enum: FAILED_TRANSACTION_STATUSES })
  @IsOptional()
  @IsIn(FAILED_TRANSACTION_STATUSES)
  status?: FailedTransactionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  operation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  escrowId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1_000_000, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
