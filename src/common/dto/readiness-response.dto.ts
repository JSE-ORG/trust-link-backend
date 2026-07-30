import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

type ComponentStatus = 'ok' | 'down';
type OptionalComponentStatus = ComponentStatus | 'disabled';

/**
 * Nested per-component details included in the readiness response when one
 * or more required components (db / horizon) are down. Redis is optional
 * and its failures appear only on the top-level `redis` field.
 */
export class ReadinessComponentHealthDto {
  @ApiProperty({
    description: 'Per-component status.',
    enum: ['ok', 'down'],
    example: 'down',
  })
  status!: ComponentStatus;

  @ApiPropertyOptional({
    description: 'Human-readable reason the component reported unhealthy.',
    example: 'connection refused',
  })
  error?: string;
}

/**
 * Response body for the readiness probe at GET /health/ready (and the
 * legacy GET /health alias). A readiness probe answers: "Is this instance
 * ready to accept real user traffic right now?" It checks every required
 * downstream dependency and returns 503 when any of them is unreachable.
 *
 * Redis is treated as optional infrastructure: a disabled or down Redis
 * is reported accurately on the `redis` field but does NOT flip the
 * overall `status` to 'down', matching the graceful-fallback behaviour
 * documented in issue #31.
 */
export class ReadinessResponseDto {
  @ApiProperty({
    description:
      'Overall readiness. "ok" only when both db and horizon report healthy.',
    enum: ['ok', 'down'],
    example: 'ok',
  })
  status!: ComponentStatus;

  @ApiProperty({
    description: 'PostgreSQL / Prisma connectivity status.',
    enum: ['ok', 'down'],
    example: 'ok',
  })
  db!: ComponentStatus;

  @ApiProperty({
    description: 'Stellar Horizon reachability status.',
    enum: ['ok', 'down'],
    example: 'ok',
  })
  horizon!: ComponentStatus;

  @ApiProperty({
    description:
      'Redis status. "disabled" means no REDIS_URL was configured; "down" is reported but does not change overall status.',
    enum: ['ok', 'down', 'disabled'],
    example: 'ok',
  })
  redis!: OptionalComponentStatus;

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

  @ApiProperty({
    description: 'Total wall-clock time spent performing the checks, ms.',
    example: 42,
  })
  durationMs!: number;

  @ApiPropertyOptional({
    description:
      'Per-component error details. Only populated when at least one required component is down.',
    type: 'object',
    properties: {
      db: { $ref: '#/components/schemas/ReadinessComponentHealthDto' } as any,
      horizon: { $ref: '#/components/schemas/ReadinessComponentHealthDto' } as any,
    },
  })
  details?: {
    db?: ReadinessComponentHealthDto;
    horizon?: ReadinessComponentHealthDto;
  };
}
