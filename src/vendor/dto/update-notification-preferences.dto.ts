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

/**
 * Request body for updating vendor notification preferences. Controls
 * which events trigger notifications, which delivery channels are used,
 * and optional webhook configuration for real-time updates.
 */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    description: 'Whether to send notifications when a delivery is completed.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnDelivery?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to send notifications when a shipment is delayed.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnDelay?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to send notifications when an exception occurs.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnException?: boolean;

  @ApiPropertyOptional({
    description:
      'Preferred notification channels. At least one required, maximum two.',
    enum: [NotificationChannel],
    isArray: true,
    example: ['EMAIL', 'SMS'],
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
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((v: string) => v.toUpperCase()) : value,
  )
  notificationChannels?: string[];

  @ApiPropertyOptional({
    description:
      'Webhook URL for receiving real-time delivery event notifications.',
    example: 'https://example.com/webhook',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim())
  webhookUrl?: string;

  @ApiPropertyOptional({
    description:
      'Secret key for signing webhook payloads to verify authenticity.',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim())
  webhookSecret?: string;
}
