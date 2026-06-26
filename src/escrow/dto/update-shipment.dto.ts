import { IsString, MaxLength, MinLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateShipmentDto {
  @ApiProperty({
    description:
      'Carrier tracking ID for the shipment. Letters, numbers, hyphens and underscores only.',
    minLength: 3,
    maxLength: 64,
    example: 'TRK-1Z999AA10123456784',
  })
  @IsString()
  @MinLength(3, { message: 'Tracking ID must be at least 3 characters long' })
  @MaxLength(64, { message: 'Tracking ID must not exceed 64 characters' })
  @Matches(/^[A-Za-z0-9\-_]+$/, {
    message:
      'Tracking ID can only contain letters, numbers, hyphens, and underscores',
  })
  @Transform(({ value }) => value?.trim())
  trackingId!: string;
}
