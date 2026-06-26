import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

export class UpdateBuyerContactDto {
  @ApiPropertyOptional({
    description: 'Buyer email address for shipping and delivery notifications.',
    example: 'buyer@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;

  @ApiPropertyOptional({
    description:
      'Buyer phone number in E.164 format for SMS notifications.',
    example: '+2348012345678',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be a valid E.164 number (e.g. +2348012345678)',
  })
  phone?: string;

  // Cross-field guard: at least one of email or phone must be present.
  // ValidateIf on a sentinel field is the idiomatic class-validator approach.
  @ValidateIf((o: UpdateBuyerContactDto) => !o.email && !o.phone)
  @IsString({ message: 'At least one of email or phone is required' })
  readonly _atLeastOne?: never;
}