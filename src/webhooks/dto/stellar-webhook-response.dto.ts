import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StellarWebhookResponseDto {
  @ApiProperty({
    description: 'Whether the webhook event was received successfully.',
    example: true,
  })
  received!: boolean;

  @ApiPropertyOptional({
    description: 'Whether the event was skipped (e.g. duplicate).',
    example: false,
  })
  skipped?: boolean;

  @ApiPropertyOptional({
    description: 'Reason the event was skipped, if applicable.',
    example: 'Duplicate event',
  })
  reason?: string;
}
