import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateVendorProfileDto {
  @IsString()
  @MinLength(2)
  businessName!: string;

  @IsEmail()
  contactEmail!: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;
}

export class UpdateVendorProfileDto {
  @IsString()
  @MinLength(2)
  @IsOptional()
  businessName?: string;

  @IsEmail()
  @IsOptional()
  contactEmail?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;
}

export class UpdateNotificationPreferencesDto {
  @IsBoolean()
  @IsOptional()
  email?: boolean;

  @IsBoolean()
  @IsOptional()
  sms?: boolean;

  @IsBoolean()
  @IsOptional()
  inApp?: boolean;
}
