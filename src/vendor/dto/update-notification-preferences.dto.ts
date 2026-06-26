import {
  IsOptional,
  IsBoolean,
  IsArray,
  IsString,
  IsEnum,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Transform } from 'class-transformer';

enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
}

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  notifyOnDelivery?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnDelay?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnException?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, {
    message: 'At least one notification channel must be selected',
  })
  @ArrayMaxSize(2, {
    message: 'Maximum 2 notification channels allowed',
  })
  @IsEnum(NotificationChannel, {
    each: true,
    message: 'Each channel must be either EMAIL or SMS',
  })
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((v: string) => v.toUpperCase()) : value,
  )
  notificationChannels?: string[];

  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  webhookUrl?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  webhookSecret?: string;
}
