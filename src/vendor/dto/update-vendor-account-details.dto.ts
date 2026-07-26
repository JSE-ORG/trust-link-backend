import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request body for partially updating vendor account details. All
 * fields are optional — only provided fields are updated. Used by
 * PATCH /vendor/account-details.
 */
export class UpdateVendorAccountDetailsDto {
  @ApiPropertyOptional({
    description: 'Business licence number.',
    maxLength: 100,
    example: 'LIC-12345',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  businessLicense?: string;

  @ApiPropertyOptional({
    description: 'Tax identifier.',
    maxLength: 50,
    example: 'TAX-6789',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }: { value: string }) => value?.trim())
  taxId?: string;

  @ApiPropertyOptional({
    description: 'Bank account number (will be encrypted at rest).',
    maxLength: 50,
    example: '1234567890',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bankAccountNumber?: string;

  @ApiPropertyOptional({
    description: 'Bank routing number.',
    maxLength: 50,
    example: '021000021',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bankRoutingNumber?: string;

  @ApiPropertyOptional({
    description: 'Accepted payment methods.',
    example: ['USDC', 'XLM'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paymentMethods?: string[];

  @ApiPropertyOptional({
    description: 'Preferred settlement currency.',
    example: 'USDC',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  preferredCurrency?: string;

  @ApiPropertyOptional({ description: 'Billing street address.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  billingAddress?: string;

  @ApiPropertyOptional({ description: 'Billing city.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingCity?: string;

  @ApiPropertyOptional({ description: 'Billing state / province.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingState?: string;

  @ApiPropertyOptional({ description: 'Billing country code (ISO 3166-1).' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  billingCountry?: string;

  @ApiPropertyOptional({ description: 'Billing postal / ZIP code.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingPostalCode?: string;

  @ApiPropertyOptional({ description: 'Shipping street address.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  shippingAddress?: string;

  @ApiPropertyOptional({ description: 'Shipping city.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  shippingCity?: string;

  @ApiPropertyOptional({ description: 'Shipping state / province.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  shippingState?: string;

  @ApiPropertyOptional({ description: 'Shipping country code (ISO 3166-1).' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  shippingCountry?: string;

  @ApiPropertyOptional({ description: 'Shipping postal / ZIP code.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  shippingPostalCode?: string;

  @ApiPropertyOptional({
    description: 'Vendor website URL.',
    example: 'https://acme.example.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  websiteUrl?: string;

  @ApiPropertyOptional({
    description: 'Social media links.',
    example: ['https://twitter.com/acme'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  socialMediaLinks?: string[];

  @ApiPropertyOptional({
    description: 'Business hours description.',
    example: 'Mon-Fri 9am-5pm EST',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessHours?: string;

  @ApiPropertyOptional({
    description: 'IANA timezone identifier.',
    example: 'America/New_York',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Preferred language code (ISO 639-1).',
    example: 'en',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @ApiPropertyOptional({ description: 'Free-form compliance notes.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  complianceNotes?: string;
}
