import {
  ArrayMaxSize,
  IsArray,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
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
    maxItems: 20,
    items: { type: 'string', maxLength: 50 },
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  paymentMethods?: string[];

  @ApiPropertyOptional({
    description: 'Preferred settlement currency.',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  @IsISO4217CurrencyCode()
  preferredCurrency?: string;

  @ApiPropertyOptional({
    description: 'Billing street address.',
    example: '123 Market Street',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  billingAddress?: string;

  @ApiPropertyOptional({
    description: 'Billing city.',
    example: 'San Francisco',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingCity?: string;

  @ApiPropertyOptional({
    description: 'Billing state / province.',
    example: 'CA',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  billingState?: string;

  @ApiPropertyOptional({
    description: 'Billing country code (ISO 3166-1).',
    example: 'US',
  })
  @IsOptional()
  @IsString()
  @IsISO31661Alpha2()
  billingCountry?: string;

  @ApiPropertyOptional({
    description: 'Billing postal / ZIP code.',
    example: '94105',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingPostalCode?: string;

  @ApiPropertyOptional({
    description: 'Shipping street address.',
    example: '456 Mission Street',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  shippingAddress?: string;

  @ApiPropertyOptional({
    description: 'Shipping city.',
    example: 'San Francisco',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  shippingCity?: string;

  @ApiPropertyOptional({
    description: 'Shipping state / province.',
    example: 'CA',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  shippingState?: string;

  @ApiPropertyOptional({
    description: 'Shipping country code (ISO 3166-1).',
    example: 'US',
  })
  @IsOptional()
  @IsString()
  @IsISO31661Alpha2()
  shippingCountry?: string;

  @ApiPropertyOptional({
    description: 'Shipping postal / ZIP code.',
    example: '94105',
  })
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
  @IsUrl()
  @MaxLength(500)
  websiteUrl?: string;

  @ApiPropertyOptional({
    description: 'Social media links.',
    example: ['https://twitter.com/acme'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
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
  @IsTimeZone()
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

  @ApiPropertyOptional({
    description: 'Free-form compliance notes.',
    example: 'KYC documents verified on 2026-05-27.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  complianceNotes?: string;
}
