import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PerformanceMetricsDto {
  @ApiProperty({
    description: 'Unix timestamp of the request.',
    example: 1690000000000,
  })
  timestamp!: number;

  @ApiProperty({ description: 'Response time in milliseconds.', example: 125 })
  responseTime!: number;

  @ApiProperty({ description: 'HTTP status code returned.', example: 200 })
  statusCode!: number;

  @ApiProperty({
    description: 'Whether the request was successful.',
    example: true,
  })
  success!: boolean;

  @ApiPropertyOptional({
    description: 'Error message if the request failed.',
    example: 'timeout',
  })
  error?: string;
}

export class AlertDto {
  @ApiProperty({
    description: 'Unix timestamp when the alert was generated.',
    example: 1690000000000,
  })
  timestamp!: number;

  @ApiProperty({
    description: 'Type of alert.',
    enum: ['PERFORMANCE_DROP', 'ERROR_RATE', 'THROUGHPUT_DROP'],
    example: 'ERROR_RATE',
  })
  type!: 'PERFORMANCE_DROP' | 'ERROR_RATE' | 'THROUGHPUT_DROP';

  @ApiProperty({
    description: 'Alert severity level.',
    enum: ['INFO', 'WARNING', 'CRITICAL'],
    example: 'CRITICAL',
  })
  severity!: 'INFO' | 'WARNING' | 'CRITICAL';

  @ApiProperty({
    description: 'Human-readable alert message.',
    example: 'Error rate 12.50% exceeds threshold 5%',
  })
  message!: string;

  @ApiProperty({
    description: 'Name of the metric that triggered the alert.',
    example: 'errorRate',
  })
  metric!: string;

  @ApiProperty({ description: 'Observed value of the metric.', example: 12.5 })
  value!: number;

  @ApiProperty({
    description: 'Configured threshold for the metric.',
    example: 5,
  })
  threshold!: number;
}

export class ProfileResultDto {
  @ApiProperty({
    description: 'Zero-based index of the profile in the test config.',
    example: 0,
  })
  profileIndex!: number;

  @ApiProperty({ example: 1000 })
  totalRequests!: number;

  @ApiProperty({ example: 950 })
  successfulRequests!: number;

  @ApiProperty({ example: 50 })
  failedRequests!: number;

  @ApiProperty({ example: 120.5 })
  averageResponseTime!: number;

  @ApiProperty({ example: 10 })
  minResponseTime!: number;

  @ApiProperty({ example: 3500 })
  maxResponseTime!: number;

  @ApiProperty({ example: 95 })
  p50ResponseTime!: number;

  @ApiProperty({ example: 450 })
  p95ResponseTime!: number;

  @ApiProperty({ example: 1200 })
  p99ResponseTime!: number;

  @ApiProperty({ description: 'Requests per second.', example: 16.7 })
  throughput!: number;

  @ApiProperty({ description: 'Percentage of failed requests.', example: 5 })
  errorRate!: number;

  @ApiProperty({
    description: 'Per-request metrics.',
    type: [PerformanceMetricsDto],
  })
  metrics!: PerformanceMetricsDto[];

  @ApiProperty({
    description: 'Alerts generated for this profile.',
    type: [AlertDto],
  })
  alerts!: AlertDto[];
}

export class OverallMetricsDto {
  @ApiProperty({ example: 3000 })
  totalRequests!: number;

  @ApiProperty({ example: 2850 })
  successfulRequests!: number;

  @ApiProperty({ example: 150 })
  failedRequests!: number;

  @ApiProperty({ example: 130.2 })
  averageResponseTime!: number;

  @ApiProperty({ description: 'Overall error rate percentage.', example: 5 })
  overallErrorRate!: number;

  @ApiProperty({
    description: 'Overall throughput in requests per second.',
    example: 50,
  })
  overallThroughput!: number;
}

export class StressTestResultDto {
  @ApiProperty({
    description: 'Unique identifier for the test run.',
    example: 'test_1690000000000_abc123def',
  })
  testId!: string;

  @ApiProperty({
    description: 'Name of the stress test.',
    example: 'Login endpoint load test',
  })
  testName!: string;

  @ApiProperty({
    description: 'Unix timestamp when the test started.',
    example: 1690000000000,
  })
  startTime!: number;

  @ApiProperty({
    description: 'Unix timestamp when the test ended.',
    example: 1690000060000,
  })
  endTime!: number;

  @ApiProperty({
    description: 'Total duration in milliseconds.',
    example: 60000,
  })
  duration!: number;

  @ApiProperty({
    description: 'Results for each virtual profile.',
    type: [ProfileResultDto],
  })
  profileResults!: ProfileResultDto[];

  @ApiProperty({
    description: 'Aggregated metrics across all profiles.',
    type: OverallMetricsDto,
  })
  overallMetrics!: OverallMetricsDto;

  @ApiProperty({
    description: 'Alerts generated across all profiles.',
    type: [AlertDto],
  })
  alerts!: AlertDto[];

  @ApiProperty({
    description: 'Final status of the test run.',
    enum: ['COMPLETED', 'FAILED', 'INTERRUPTED'],
    example: 'COMPLETED',
  })
  status!: 'COMPLETED' | 'FAILED' | 'INTERRUPTED';
}
