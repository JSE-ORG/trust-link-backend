import { IsIn, IsString } from 'class-validator';

export class ResolveDisputeDto {
  @IsString()
  @IsIn(['RELEASE', 'REFUND'])
  resolution!: 'RELEASE' | 'REFUND';
}
