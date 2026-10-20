import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A single lifecycle event for an escrow, as returned by the events
 * endpoint. Events are emitted by the EscrowEvent audit log and always
 * include the from-state, to-state and the timestamp the transition was
 * recorded.
 */
export class EscrowEventEntryDto {
  @ApiProperty({
    description:
      'The lifecycle event/state name (e.g. CREATED, SHIPPED, DELIVERED).',
    example: 'SHIPPED',
  })
  event!: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the transition was recorded.',
    type: String,
    format: 'date-time',
    example: '2026-05-20T14:32:00.000Z',
  })
  occurredAt!: Date;

  @ApiPropertyOptional({
    description:
      'State the escrow was in before the transition, or null for the initial CREATED event.',
    nullable: true,
    example: 'FUNDED',
  })
  fromState!: string | null;

  @ApiProperty({
    description: 'State the escrow transitioned into.',
    example: 'SHIPPED',
  })
  toState!: string;
}
