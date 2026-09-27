import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Nested tracking settings object returned when updating vendor notification preferences.
 */
export class VendorTrackingSettingsResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the vendor tracking settings record.',
    example: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
  })
  id!: string;

  @ApiProperty({
    description: 'Stellar public key of the vendor.',
    example: 'GAIGZHHWK3REZQPLQX5DNFRYDUPFGG6VY4PSWSL53N2OY3Z3H3CE5TMK',
  })
  vendorAddress!: string;

  @ApiProperty({
    description: 'Whether real-time shipment tracking is enabled.',
    example: true,
  })
  enableTracking!: boolean;

  @ApiPropertyOptional({
    description: 'Logistics tracking provider name.',
    nullable: true,
    example: 'fedex',
  })
  trackingProvider!: string | null;

  @ApiPropertyOptional({
    description: 'API key for the tracking provider.',
    nullable: true,
    example: null,
  })
  trackingApiKey!: string | null;

  @ApiProperty({
    description: 'Whether tracking updates are polled automatically.',
    example: true,
  })
  autoUpdateTracking!: boolean;

  @ApiProperty({
    description: 'Interval in minutes between automated tracking polls.',
    example: 60,
  })
  trackingUpdateInterval!: number;

  @ApiProperty({
    description: 'Whether notifications are sent upon successful delivery.',
    example: true,
  })
  notifyOnDelivery!: boolean;

  @ApiProperty({
    description: 'Whether notifications are sent upon shipment delays.',
    example: true,
  })
  notifyOnDelay!: boolean;

  @ApiProperty({
    description: 'Whether notifications are sent upon shipping exceptions.',
    example: true,
  })
  notifyOnException!: boolean;

  @ApiProperty({
    description:
      'Threshold in hours before a delayed shipment triggers an alert.',
    example: 24,
  })
  delayThresholdHours!: number;

  @ApiProperty({
    description: 'Whether delivery confirmation is required.',
    example: true,
  })
  deliveryConfirmation!: boolean;

  @ApiProperty({
    description: 'Whether signature upon delivery is required.',
    example: false,
  })
  requireSignature!: boolean;

  @ApiProperty({
    description: 'Whether shipping insurance is required.',
    example: false,
  })
  insuranceRequired!: boolean;

  @ApiPropertyOptional({
    description: 'Declared insurance value for shipments.',
    nullable: true,
    example: null,
  })
  insuranceValue!: number | null;

  @ApiPropertyOptional({
    description: 'Custom tracking rule configurations.',
    nullable: true,
    example: null,
  })
  customTrackingRules!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description: 'Webhook endpoint URL for delivery event notifications.',
    nullable: true,
    example: 'https://example.com/webhook',
  })
  webhookUrl!: string | null;

  @ApiPropertyOptional({
    description: 'Secret token used to sign webhook deliveries.',
    nullable: true,
    example: null,
  })
  webhookSecret!: string | null;

  @ApiProperty({
    description: 'Enabled notification channels.',
    type: [String],
    example: ['EMAIL'],
  })
  notificationChannels!: string[];

  @ApiProperty({
    description: 'Number of days tracking history is retained.',
    example: 90,
  })
  trackingHistoryRetentionDays!: number;

  @ApiProperty({
    description: 'ISO-8601 timestamp when tracking settings were created.',
    type: String,
    format: 'date-time',
    example: '2026-02-14T09:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'ISO-8601 timestamp when tracking settings were last updated.',
    type: String,
    format: 'date-time',
    example: '2026-05-01T11:22:00.000Z',
  })
  updatedAt!: Date;
}

/**
 * Response body returned by PATCH /vendor/profile/notifications.
 */
export class UpdateNotificationPreferencesResponseDto {
  @ApiProperty({
    description: 'The updated vendor tracking settings.',
    type: VendorTrackingSettingsResponseDto,
  })
  trackingSettings!: VendorTrackingSettingsResponseDto;
}
