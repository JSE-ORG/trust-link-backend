import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for GET /vendor/profile/notifications containing the
 * vendor's current notification preferences including delivery channels,
 * webhook configuration, and tracking settings.
 */
export class NotificationPreferencesResponseDto {
  @ApiProperty({
    description: 'Whether to send notifications on delivery.',
    example: true,
  })
  notifyOnDelivery!: boolean;

  @ApiProperty({
    description: 'Whether to send notifications on delay.',
    example: true,
  })
  notifyOnDelay!: boolean;

  @ApiProperty({
    description: 'Whether to send notifications on exception.',
    example: true,
  })
  notifyOnException!: boolean;

  @ApiProperty({
    description: 'Preferred notification channels.',
    example: ['EMAIL', 'SMS'],
    type: [String],
  })
  notificationChannels!: string[];

  @ApiProperty({
    description: 'Webhook URL for delivery events, if configured.',
    nullable: true,
    example: 'https://example.com/webhook',
  })
  webhookUrl!: string | null;

  @ApiProperty({
    description: 'Whether real-time tracking updates are enabled.',
    example: true,
  })
  enableTracking!: boolean;

  @ApiProperty({
    description:
      'Delay threshold in hours before triggering delay notifications.',
    example: 24,
  })
  delayThresholdHours!: number;

  @ApiProperty({
    description: 'Whether delivery confirmation is required.',
    example: true,
  })
  deliveryConfirmation!: boolean;

  @ApiProperty({
    description: 'Number of days to retain tracking history.',
    example: 90,
  })
  trackingHistoryRetentionDays!: number;
}
