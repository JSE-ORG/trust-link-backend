import { IsString, MaxLength, MinLength, Matches, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request body for marking an escrow as shipped. The vendor provides a
 * carrier tracking ID which must be at least 3 characters and contain
 * only letters, numbers, hyphens and underscores. An optional `carrier`
 * may be specified; when omitted the carrier is auto-detected from the
 * tracking ID format, falling back to GIGL.
 */
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
  @Transform(({ value }: { value: string }) => value?.trim())
  trackingId!: string;

  @ApiPropertyOptional({
    description:
      'Logistics carrier for this tracking ID (e.g. "GIGL"). When omitted the ' +
      'carrier is auto-detected from the tracking ID format, falling back to GIGL.',
    example: 'GIGL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Carrier must not exceed 32 characters' })
  @Transform(({ value }: { value: string }) => value?.trim() || undefined)
  carrier?: string;
}
