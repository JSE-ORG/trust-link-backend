import {
  IsNumber,
  IsPositive,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsStellarAddress } from '../../common/validators/stellar-address.validator';

/**
 * Request body for creating a new escrow. The vendor supplies the item
 * details, amount, currency and the buyer's Stellar address. A new
 * escrow record is created in the FUNDED state and a payment URL is
 * returned so the buyer can complete the Stellar transaction.
 */
export class CreateEscrowDto {
  @ApiProperty({
    description: 'Human-readable name of the item being escrowed.',
    minLength: 3,
    maxLength: 100,
    example: 'Sony A7 IV Mirrorless Camera',
  })
  @IsString()
  @MinLength(3, { message: 'Item name must be at least 3 characters long' })
  @MaxLength(100, { message: 'Item name must not exceed 100 characters' })
  @Transform(({ value }) => value?.trim())
  itemName!: string;

  @ApiProperty({
    description: 'Vendor-side reference or SKU that identifies the item.',
    minLength: 3,
    example: 'SKU-CAM-A7IV-001',
  })
  @IsString()
  @MinLength(3)
  itemRef!: string;

  @ApiProperty({
    description: 'Escrow amount in the given currency. Must be positive.',
    example: 2499.99,
  })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({
    description:
      'Asset code for the escrow amount. Uppercase letters and digits only.',
    minLength: 3,
    maxLength: 12,
    example: 'USDC',
  })
  @IsString()
  @MinLength(3, { message: 'Currency must be at least 3 characters long' })
  @MaxLength(12, { message: 'Currency must not exceed 12 characters' })
  @Matches(/^[A-Z0-9]+$/, {
    message: 'Currency must contain only uppercase letters and numbers',
  })
  @Transform(({ value }) => value?.toUpperCase().trim())
  currency!: string;

  @ApiProperty({
    description: 'Stellar public key of the buyer funding the escrow.',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsString()
  @IsStellarAddress()
  @Transform(({ value }) => value?.trim())
  buyerAddress!: string;
}
