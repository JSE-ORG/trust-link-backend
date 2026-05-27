import { IsString, MaxLength, MinLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateShipmentDto {
  @IsString()
  @MinLength(3, { message: 'Tracking ID must be at least 3 characters long' })
  @MaxLength(64, { message: 'Tracking ID must not exceed 64 characters' })
  @Matches(/^[A-Za-z0-9\-_]+$/, { message: 'Tracking ID can only contain letters, numbers, hyphens, and underscores' })
  @Transform(({ value }) => value?.trim())
  trackingId!: string;
}
