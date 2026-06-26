import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RotateApiKeyDto {
  @ApiProperty({
    description: 'The new API key value to rotate in.',
    example: 'tl_live_9f8c2b1a7e6d4c3b0a1f2e3d4c5b6a7e',
  })
  @IsString()
  @IsNotEmpty()
  key: string;
}
