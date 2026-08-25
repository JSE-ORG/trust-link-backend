import { ApiProperty } from '@nestjs/swagger';

/**
 * Response body for the lightweight liveness probe at GET /health/live.
 *
 * A liveness probe answers: "Is the process still running and capable of
 * serving HTTP responses?" It must NOT touch any downstream dependencies.
 * If this endpoint fails the orchestrator restarts the container, so any
 * transient external outage must NOT be reflected here.
 */
export class LivenessResponseDto {
  @ApiProperty({
    description: 'Always "ok" when the HTTP server is reachable.',
    enum: ['ok'],
    example: 'ok',
  })
  status!: 'ok';

  @ApiProperty({
    description: 'Timestamp the response was generated.',
    type: String,
    format: 'date-time',
    example: '2026-07-28T10:15:30.000Z',
  })
  timestamp!: string;

  @ApiProperty({
    description: 'Current NODE_ENV value.',
    example: 'production',
  })
  environment!: string;

  @ApiProperty({
    description: 'Application version from package.json.',
    example: '1.4.2',
  })
  version!: string;
}
