import { ApiProperty } from '@nestjs/swagger';

export interface StandardErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  requestId: string;
  details?: unknown;
}

export class ErrorResponseDto implements StandardErrorResponse {
  @ApiProperty({ example: 400, description: 'HTTP status code.' })
  statusCode!: number;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: 'Validation failed' },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['amount must be a positive number'],
      },
    ],
    description: 'Human-readable error message or validation messages.',
  })
  message!: string | string[];

  @ApiProperty({ example: 'BadRequestException', description: 'Error type.' })
  error!: string;

  @ApiProperty({
    example: '2026-06-27T12:00:00.000Z',
    description: 'ISO-8601 timestamp when the error response was generated.',
  })
  timestamp!: string;

  @ApiProperty({ example: '/escrow', description: 'Request path.' })
  path!: string;

  @ApiProperty({
    example: '1a1d98a2-12c2-48a9-9b4d-36e568c89b5d',
    description: 'Correlation id from x-request-id or a generated fallback.',
  })
  requestId!: string;

  @ApiProperty({
    required: false,
    description: 'Development-only diagnostic details.',
  })
  details?: unknown;
}
