import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { DisputeState } from '../../prisma/prisma.service';

/**
 * Dispute record returned by GET /escrow/:id/dispute and the admin
 * disputes listing endpoints. Contains the reason, evidence URLs,
 * status and optional resolution timestamp.
 */
export class DisputeResponseDto {
  @ApiProperty({
    description: 'Unique dispute identifier (UUID).',
    format: 'uuid',
    example: '2b8b9e44-bb2e-4e9b-9c31-0a7d9cf4a788',
  })
  id!: string;

  @ApiProperty({
    description: 'Id of the escrow this dispute was opened against.',
    format: 'uuid',
    example: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  })
  escrowId!: string;

  @ApiProperty({
    description:
      'Short reason category the buyer selected when opening the dispute.',
    enum: [
      'ITEM_NOT_AS_DESCRIBED',
      'ITEM_NOT_RECEIVED',
      'DAMAGED_ITEM',
      'FRAUD',
      'OTHER',
    ],
    example: 'DAMAGED_ITEM',
  })
  reason!: string;

  @ApiProperty({
    description: 'Free-form detailed description provided by the buyer.',
    example:
      'The camera arrived with a cracked LCD screen and the lens mount is loose.',
  })
  description!: string;

  @ApiProperty({
    description: 'Evidence URLs (photos, receipts) attached to the dispute.',
    type: [String],
    example: [
      'https://evidence.trustlink.io/disputes/abc/photo-1.jpg',
      'https://evidence.trustlink.io/disputes/abc/receipt.pdf',
    ],
  })
  evidenceUrls!: string[];

  @ApiProperty({
    description: 'Current lifecycle state of the dispute.',
    enum: ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CANCELLED', 'ABANDONED'],
    example: 'UNDER_REVIEW',
  })
  status!: DisputeState;

  @ApiPropertyOptional({
    description:
      'ISO-8601 timestamp the dispute was resolved (closed), or null if still open.',
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-05-24T09:15:00.000Z',
  })
  resolvedAt!: Date | null;

  @ApiProperty({
    description: 'ISO-8601 timestamp the dispute record was created.',
    type: String,
    format: 'date-time',
    example: '2026-05-22T10:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'ISO-8601 timestamp the dispute record was last modified.',
    type: String,
    format: 'date-time',
    example: '2026-05-23T14:00:00.000Z',
  })
  updatedAt!: Date;
}
