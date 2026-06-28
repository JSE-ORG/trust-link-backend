import {
  IsNumber,
  IsString,
  IsArray,
  IsOptional,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VirtualProfile {
  @ApiProperty({
    description: 'Number of concurrent virtual users to simulate.',
    minimum: 1,
    maximum: 10000,
    example: 100,
  })
  @IsNumber()
  @Min(1)
  @Max(10000)
  concurrentUsers!: number;

  @ApiProperty({
    description: 'Target number of requests per second for this profile.',
    minimum: 1,
    example: 50,
  })
  @IsNumber()
  @Min(1)
  requestsPerSecond!: number;

  @ApiProperty({
    description: 'Duration of the load profile in seconds.',
    minimum: 1,
    example: 60,
  })
  @IsNumber()
  @Min(1)
  duration!: number;

  @ApiProperty({
    description: 'API endpoint path to exercise during the test.',
    example: '/api/escrows',
  })
  @IsString()
  endpoint!: string;

  @ApiPropertyOptional({
    description: 'HTTP method to use for the requests.',
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    example: 'GET',
  })
  @IsOptional()
  @IsString()
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  @ApiPropertyOptional({
    description: 'Optional request body to send with each request.',
    type: 'object',
    additionalProperties: true,
    example: { itemName: 'Test item', amount: 100, currency: 'USDC' },
  })
  @IsOptional()
  payload?: Record<string, any>;
}

export class PerformanceThresholds {
  @ApiProperty({
    description: 'Maximum acceptable response time in milliseconds.',
    minimum: 0,
    example: 500,
  })
  @IsNumber()
  @Min(0)
  maxResponseTime!: number;

  @ApiProperty({
    description: 'Maximum acceptable error rate as a percentage (0–100).',
    minimum: 0,
    maximum: 100,
    example: 1,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  maxErrorRate!: number;

  @ApiProperty({
    description: 'Minimum acceptable throughput in requests per second.',
    minimum: 0,
    example: 40,
  })
  @IsNumber()
  @Min(0)
  minThroughput!: number;
}

export class StressTestConfigDto {
  @ApiProperty({
    description: 'Human-readable name for this stress test run.',
    example: 'escrow-create-peak-load',
  })
  @IsString()
  testName!: string;

  @ApiProperty({
    description: 'One or more load profiles to run as part of the test.',
    type: [VirtualProfile],
  })
  @IsArray()
  profiles!: VirtualProfile[];

  @ApiPropertyOptional({
    description: 'Pass/fail thresholds evaluated against the run results.',
    type: PerformanceThresholds,
  })
  @IsOptional()
  thresholds?: PerformanceThresholds;

  @ApiPropertyOptional({
    description: 'Time in seconds to ramp up to the full concurrent user count.',
    minimum: 1,
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  rampUpTime?: number;

  @ApiPropertyOptional({
    description: 'Whether to emit alerts when thresholds are breached.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  enableAlerts?: boolean;
}
