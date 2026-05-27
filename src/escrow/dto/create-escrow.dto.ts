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
import { IsStellarAddress } from '../../common/validators/stellar-address.validator';

export class CreateEscrowDto {
  @IsString()
  @MinLength(3, { message: 'Item name must be at least 3 characters long' })
  @MaxLength(100, { message: 'Item name must not exceed 100 characters' })
  @Transform(({ value }) => value?.trim())
  itemName!: string;

  @IsString()
  @MinLength(3)
  itemRef!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(3, { message: 'Currency must be at least 3 characters long' })
  @MaxLength(12, { message: 'Currency must not exceed 12 characters' })
  @Matches(/^[A-Z0-9]+$/, { message: 'Currency must contain only uppercase letters and numbers' })
  @Transform(({ value }) => value?.toUpperCase().trim())
  currency!: string;

  @IsString()
  @IsStellarAddress()
  @Transform(({ value }) => value?.trim())
  buyerAddress!: string;
}
