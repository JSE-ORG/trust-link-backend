import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Categories of dispute reasons supported by the platform.
 */
export enum DisputeReasonCategory {
  ITEM_NOT_AS_DESCRIBED = 'ITEM_NOT_AS_DESCRIBED',
  ITEM_NOT_RECEIVED = 'ITEM_NOT_RECEIVED',
  DAMAGED_ITEM = 'DAMAGED_ITEM',
  FRAUD = 'FRAUD',
  OTHER = 'OTHER',
}

/**
 * Request body for opening a dispute against an escrow. The buyer
 * selects a reason category, provides a detailed description (minimum
 * 20 characters), and may attach evidence URLs pointing to supporting
 * files such as photos or receipts.
 */
export class OpenDisputeDto {
  @ApiProperty({
    description: 'Category that best describes the reason for the dispute.',
    enum: DisputeReasonCategory,
    example: DisputeReasonCategory.ITEM_NOT_AS_DESCRIBED,
  })
  @IsEnum(DisputeReasonCategory)
  reason!: DisputeReasonCategory;

  @ApiProperty({
    description: 'Detailed explanation of the dispute (minimum 20 characters).',
    minLength: 20,
    example:
      'The camera arrived with a cracked LCD screen and the lens mount is loose.',
  })
  @IsString()
  @MinLength(20, { message: 'Description must be at least 20 characters' })
  description!: string;

  @ApiPropertyOptional({
    description:
      'Optional list of URLs pointing to supporting evidence (photos, receipts).',
    type: [String],
    example: [
      'https://evidence.trustlink.io/disputes/abc/photo-1.jpg',
      'https://evidence.trustlink.io/disputes/abc/receipt.pdf',
    ],
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  evidenceUrls?: string[];
}
