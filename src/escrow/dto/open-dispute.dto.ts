import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
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
    description: 'Detailed explanation of the dispute (20-2000 characters).',
    minLength: 20,
    maxLength: 2000,
    example:
      'The camera arrived with a cracked LCD screen and the lens mount is loose.',
  })
  @IsString()
  @MinLength(20, { message: 'Description must be at least 20 characters' })
  @MaxLength(2000, { message: 'Description must be at most 2000 characters' })
  description!: string;

  @ApiPropertyOptional({
    description:
      'Optional list of URLs pointing to supporting evidence (photos, receipts). Max 10 URLs, 500 characters each.',
    type: [String],
    maxItems: 10,
    example: [
      'https://evidence.trustlink.io/disputes/abc/photo-1.jpg',
      'https://evidence.trustlink.io/disputes/abc/receipt.pdf',
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'At most 10 evidence URLs are allowed' })
  @IsUrl({}, { each: true })
  @MaxLength(500, { each: true, message: 'Each evidence URL must be at most 500 characters' })
  evidenceUrls?: string[];
}
