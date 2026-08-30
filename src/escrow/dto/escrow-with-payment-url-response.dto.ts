import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { EscrowState } from '../../prisma/prisma.service';

/**
 * Extended Escrow response shape returned when a new escrow is created.
 * Includes the standard EscrowResponseDto fields plus the Stellar payment
 * URL the buyer uses to fund the escrow on-chain.
 */
export class EscrowWithPaymentUrlResponseDto {
  @ApiProperty({
    description: 'Unique escrow identifier (UUID).',
    format: 'uuid',
    example: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  })
  id!: string;

  @ApiProperty({
    description: 'Human-readable name of the escrowed item.',
    example: 'Sony A7 IV Mirrorless Camera',
  })
  itemName!: string;

  @ApiProperty({
    description: 'Vendor-side reference or SKU for the item.',
    example: 'SKU-CAM-A7IV-001',
  })
  itemRef!: string;

  @ApiProperty({
    description: 'Escrow amount in the given currency.',
    example: 2499.99,
  })
  amount!: number;

  @ApiProperty({
    description: 'Asset code for the escrow amount.',
    example: 'USDC',
  })
  currency!: string;

  @ApiProperty({
    description: 'Stellar public key of the buyer funding the escrow.',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  buyerAddress!: string;

  @ApiProperty({
    description: 'Stellar public key of the vendor creating the escrow.',
    example: 'GAIGZHHWK3REZQPLQX5DNFRYDUPFGG6VY4PSWSL53N2OY3Z3H3CE5TMK',
  })
  vendorAddress!: string;

  @ApiProperty({
    description: 'Current lifecycle state of the escrow.',
    enum: [
      'CREATED',
      'FUNDED',
      'SHIPPED',
      'DELIVERED',
      'RELEASED',
      'COMPLETED',
      'REFUNDED',
      'CANCELLED',
    ],
    example: 'FUNDED',
  })
  state!: EscrowState;

  @ApiPropertyOptional({
    description: 'Carrier tracking ID, or null until the item is shipped.',
    nullable: true,
    example: 'TRK-1Z999AA10123456784',
  })
  trackingId!: string | null;

  @ApiProperty({
    description:
      'Stellar payment URL the buyer opens to fund the escrow. Typically a deep link into a wallet or the Stellar Laboratory.',
    example:
      'https://stellar.ai/tx?destination=GAIGZHHWK3REZQPLQX5DNFRYDUPFGG6VY4PSWSL53N2OY3Z3H3CE5TMK&amount=2499.99&asset=USDC',
  })
  paymentUrl!: string;

  @ApiPropertyOptional({
    description:
      'Timestamp the item was marked shipped, or null if not yet shipped.',
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-05-20T14:32:00.000Z',
  })
  shippedAt!: Date | null;

  @ApiProperty({
    description: 'Timestamp the escrow was created.',
    type: String,
    format: 'date-time',
    example: '2026-05-18T09:15:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp the escrow was last updated.',
    type: String,
    format: 'date-time',
    example: '2026-05-20T14:32:00.000Z',
  })
  updatedAt!: Date;
}
