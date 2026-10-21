import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A single tracking event in the shipment history, including timestamp,
 * status, optional location, and a human-readable description.
 */
export class TrackingEventDto {
  @ApiProperty({
    description: 'ISO-8601 timestamp when this tracking event occurred.',
    type: String,
    format: 'date-time',
    example: '2026-05-22T10:45:00.000Z',
  })
  timestamp!: Date;

  @ApiProperty({
    description: 'Carrier-supplied short status code for this event.',
    example: 'IN_TRANSIT',
  })
  status!: string;

  @ApiPropertyOptional({
    description:
      'City/state/country location string, if the carrier provides one.',
    example: 'Memphis, TN, US',
  })
  location?: string;

  @ApiProperty({
    description: 'Human-readable description of what the event represents.',
    example: 'Package arrived at destination facility.',
  })
  description!: string;
}

/**
 * Response shape for GET /escrow/:id/tracking. Contains the overall
 * shipment status, optional estimated delivery, carrier name, and a
 * chronological list of tracking events.
 */
export class TrackingResponseDto {
  @ApiProperty({
    description:
      'Overall shipment status summarised by the logistics provider.',
    example: 'IN_TRANSIT',
  })
  status!: string;

  @ApiPropertyOptional({
    description: 'Carrier-supplied estimated delivery date/time, if available.',
    type: String,
    format: 'date-time',
    example: '2026-05-24T18:00:00.000Z',
  })
  estimatedDelivery?: Date;

  @ApiPropertyOptional({
    description: 'Carrier name, e.g. the provider that generated the tracking.',
    example: 'Terminal Africa',
  })
  carrier?: string;

  @ApiProperty({
    description: 'Chronological list of tracking events for the shipment.',
    type: [TrackingEventDto],
  })
  events!: TrackingEventDto[];
}
