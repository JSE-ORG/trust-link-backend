import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DisputeStatusEnum } from '../../../common/enums/escrow-state.enum';

export class AdminDisputesQueryDto {
  @ApiPropertyOptional({ enum: DisputeStatusEnum })
  @IsOptional()
  @IsEnum(DisputeStatusEnum)
  status?: DisputeStatusEnum;

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
