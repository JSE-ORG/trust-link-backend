import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Request body for rotating a logistics provider API key. The admin
 * supplies the new key value which immediately replaces the existing
 * one for all subsequent logistics API calls.
 */
export class RotateApiKeyDto {
  @ApiProperty({
    description: 'The new API key value to rotate in.',
    maxLength: 512,
    example: 'tl_live_9f8c2b1a7e6d4c3b0a1f2e3d4c5b6a7e',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  key!: string;
}
