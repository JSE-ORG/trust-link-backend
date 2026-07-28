import { ApiProperty } from '@nestjs/swagger';
import type { EscrowState } from '../../prisma/prisma.service';

/**
 * Compact escrow representation returned in paginated vendor escrow
 * listings (GET /vendor/escrows). Contains the essential fields needed
 * for list views without exposing internal identifiers.
 */
export class EscrowSummaryDto {
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
    description: 'Current lifecycle state of the escrow.',
    enum: [
      'FUNDED',
      'SHIPPED',
      'DELIVERED',
      'RELEASED',
      'COMPLETED',
      'REFUNDED',
      'CANCELLED',
    ],
    example: 'SHIPPED',
  })
  state!: EscrowState;

  @ApiProperty({
    description: 'Carrier tracking ID, or null until the item is shipped.',
    nullable: true,
    example: 'TRK-1Z999AA10123456784',
  })
  trackingId!: string | null;

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
