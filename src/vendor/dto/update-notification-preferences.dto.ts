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
import { ApiPropertyOptional } from '@nestjs/swagger';

enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
}

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    description: 'Notify vendor when shipment is delivered.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnDelivery?: boolean;

  @ApiPropertyOptional({
    description: 'Notify vendor when shipment is delayed.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnDelay?: boolean;

  @ApiPropertyOptional({
    description: 'Notify vendor when a shipment exception occurs.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnException?: boolean;

  @ApiPropertyOptional({
    description: 'Notification channels to use. Allowed: EMAIL, SMS.',
    enum: NotificationChannel,
    isArray: true,
    example: ['EMAIL'],
  })
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

  @ApiPropertyOptional({
    description: 'Webhook URL to POST events to.',
    example: 'https://vendor.example.com/webhooks/trustlink',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  webhookUrl?: string;

  @ApiPropertyOptional({
    description: 'Secret used to sign webhook payloads (HMAC-SHA256).',
    example: 'whsec_abc123',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  webhookSecret?: string;
}
