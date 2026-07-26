import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VendorAccountDetailsRecord } from '../../prisma/prisma.service';

/**
 * Response DTO for vendor account details. Sensitive fields (bank account
 * number, tax identifier) are masked to prevent full exposure in API responses.
 */
export class VendorAccountDetailsResponseDto {
  @ApiProperty({ example: 'account-GD3W57WQA...' })
  id!: string;

  @ApiProperty({ example: 'GD3W57WQA...' })
  vendorAddress!: string;

  @ApiPropertyOptional({ example: 'LIC-12345' })
  businessLicense: string | null = null;

  @ApiPropertyOptional({ example: '****6789' })
  taxId: string | null = null;

  @ApiPropertyOptional({ example: '****1234' })
  bankAccountNumber: string | null = null;

  @ApiPropertyOptional({ example: '021000021' })
  bankRoutingNumber: string | null = null;

  @ApiProperty({ example: ['USDC', 'XLM'] })
  paymentMethods: string[] = [];

  @ApiProperty({ example: 'USDC' })
  preferredCurrency: string = 'USD';

  @ApiPropertyOptional()
  billingAddress: string | null = null;

  @ApiPropertyOptional()
  billingCity: string | null = null;

  @ApiPropertyOptional()
  billingState: string | null = null;

  @ApiPropertyOptional()
  billingCountry: string | null = null;

  @ApiPropertyOptional()
  billingPostalCode: string | null = null;

  @ApiPropertyOptional()
  shippingAddress: string | null = null;

  @ApiPropertyOptional()
  shippingCity: string | null = null;

  @ApiPropertyOptional()
  shippingState: string | null = null;

  @ApiPropertyOptional()
  shippingCountry: string | null = null;

  @ApiPropertyOptional()
  shippingPostalCode: string | null = null;

  @ApiPropertyOptional({ example: 'https://acme.example.com' })
  websiteUrl: string | null = null;

  @ApiProperty({ example: ['https://twitter.com/acme'] })
  socialMediaLinks: string[] = [];

  @ApiPropertyOptional({ example: 'Mon-Fri 9am-5pm EST' })
  businessHours: string | null = null;

  @ApiProperty({ example: 'America/New_York' })
  timezone: string = 'UTC';

  @ApiProperty({ example: 'en' })
  language: string = 'en';

  @ApiProperty({ example: 'PENDING' })
  verificationStatus: string = 'PENDING';

  @ApiPropertyOptional()
  verifiedAt: Date | null = null;

  @ApiProperty({ example: 'NOT_STARTED' })
  kycStatus: string = 'NOT_STARTED';

  @ApiPropertyOptional()
  kycCompletedAt: Date | null = null;

  @ApiProperty({ example: 0 })
  riskScore: number = 0;

  @ApiPropertyOptional()
  complianceNotes: string | null = null;

  @ApiPropertyOptional()
  customFields: Record<string, unknown> | null = null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  /** Masks sensitive fields for safe API responses. */
  static fromRecord(
    record: VendorAccountDetailsRecord,
  ): VendorAccountDetailsResponseDto {
    return {
      id: record.id,
      vendorAddress: record.vendorAddress,
      businessLicense: record.businessLicense,
      taxId: maskSensitiveField(record.taxId),
      bankAccountNumber: maskSensitiveField(record.bankAccountNumber),
      bankRoutingNumber: record.bankRoutingNumber,
      paymentMethods: record.paymentMethods,
      preferredCurrency: record.preferredCurrency,
      billingAddress: record.billingAddress,
      billingCity: record.billingCity,
      billingState: record.billingState,
      billingCountry: record.billingCountry,
      billingPostalCode: record.billingPostalCode,
      shippingAddress: record.shippingAddress,
      shippingCity: record.shippingCity,
      shippingState: record.shippingState,
      shippingCountry: record.shippingCountry,
      shippingPostalCode: record.shippingPostalCode,
      websiteUrl: record.websiteUrl,
      socialMediaLinks: record.socialMediaLinks,
      businessHours: record.businessHours,
      timezone: record.timezone,
      language: record.language,
      verificationStatus: record.verificationStatus,
      verifiedAt: record.verifiedAt,
      kycStatus: record.kycStatus,
      kycCompletedAt: record.kycCompletedAt,
      riskScore: record.riskScore,
      complianceNotes: record.complianceNotes,
      customFields: record.customFields,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

/**
 * Masks a sensitive string field by showing only the last 4 characters.
 * Returns null if the input is null or undefined.
 */
function maskSensitiveField(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (value.length <= 4) return '****';
  return '*'.repeat(value.length - 4) + value.slice(-4);
}
