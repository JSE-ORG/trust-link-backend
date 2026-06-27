import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request body for partially updating an existing vendor profile. All
 * fields are optional — only provided fields are updated. Used by
 * PATCH /vendor/profile.
 */
export class UpdateVendorProfileDto {
  @ApiPropertyOptional({
    description: 'Updated registered business or trading name of the vendor.',
    minLength: 2,
    maxLength: 100,
    example: 'Acme Electronics Ltd',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Business name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Business name must not exceed 100 characters' })
  @Transform(({ value }) => value?.trim())
  businessName?: string;

  @ApiPropertyOptional({
    description: 'Updated contact email address for the vendor.',
    format: 'email',
    example: 'sales@acme-electronics.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Must be a valid email address' })
  email?: string;

  @ApiPropertyOptional({
    description: 'Updated contact phone number for the vendor.',
    maxLength: 20,
    example: '+1-415-555-0142',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Phone must not exceed 20 characters' })
  phone?: string;

  @ApiPropertyOptional({
    description: 'Updated short description of the vendor.',
    maxLength: 500,
    example: 'Authorized reseller of consumer electronics and camera equipment.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;
}
