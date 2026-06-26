import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveDisputeDto {
  @ApiProperty({
    description:
      'Resolution outcome: RELEASE funds to the vendor, or REFUND them to the buyer.',
    enum: ['RELEASE', 'REFUND'],
    example: 'RELEASE',
  })
  @IsString()
  @IsIn(['RELEASE', 'REFUND'])
  resolution!: 'RELEASE' | 'REFUND';
}
