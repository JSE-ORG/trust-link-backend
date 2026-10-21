import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response body returned by POST /vendor/profile when a new vendor profile
 * is created, and by PUT /vendor/profile for upserts and PATCH /vendor/profile
 * for partial updates. Sensitive PII is not returned — this is the
 * projection shown back to the authenticated vendor themselves.
 */
export class VendorProfileResponseDto {
  @ApiProperty({
    description: 'Stellar public key of the vendor — the profile primary key.',
    example: 'GAIGZHHWK3REZQPLQX5DNFRYDUPFGG6VY4PSWSL53N2OY3Z3H3CE5TMK',
  })
  address!: string;

  @ApiProperty({
    description: 'Registered business or trading name of the vendor.',
    example: 'Acme Electronics Ltd',
  })
  businessName!: string;

  @ApiPropertyOptional({
    description: 'Contact email address for the vendor.',
    format: 'email',
    nullable: true,
    example: 'sales@acme-electronics.com',
  })
  email!: string | null;

  @ApiPropertyOptional({
    description: 'Contact phone number for the vendor.',
    nullable: true,
    example: '+1-415-555-0142',
  })
  phone!: string | null;

  @ApiPropertyOptional({
    description: 'Short description of the vendor and what they sell.',
    nullable: true,
    example:
      'Authorized reseller of consumer electronics and camera equipment.',
  })
  description!: string | null;

  @ApiProperty({
    description: 'ISO-8601 timestamp the vendor profile was created.',
    type: String,
    format: 'date-time',
    example: '2026-02-14T09:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'ISO-8601 timestamp the vendor profile was last modified.',
    type: String,
    format: 'date-time',
    example: '2026-05-01T11:22:00.000Z',
  })
  updatedAt!: Date;
}
