import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type { FailedTransactionStatus } from '../dlq.types';

const FAILED_TRANSACTION_STATUSES = [
  'PENDING_REVIEW',
  'REPLAYING',
  'REPLAYED',
  'ABANDONED',
] as const satisfies readonly FailedTransactionStatus[];

export class ListFailedTransactionsQueryDto {
  @ApiPropertyOptional({
    enum: FAILED_TRANSACTION_STATUSES,
    description: 'Filter failed transactions by replay lifecycle status.',
    example: 'PENDING_REVIEW',
  })
  @IsOptional()
  @IsIn(FAILED_TRANSACTION_STATUSES)
  status?: FailedTransactionStatus;

  @ApiPropertyOptional({
    description: 'Filter failed transactions by operation name.',
    example: 'fund',
  })
  @IsOptional()
  @IsString()
  operation?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter failed transactions by escrow ID.',
    example: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  })
  @IsOptional()
  @IsUUID()
  escrowId?: string;

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
