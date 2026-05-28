import { IsNumber, IsString, IsArray, IsOptional, Min, Max, IsBoolean } from 'class-validator';

export class VirtualProfile {
  @IsNumber()
  @Min(1)
  @Max(10000)
  concurrentUsers: number;

  @IsNumber()
  @Min(1)
  requestsPerSecond: number;

  @IsNumber()
  @Min(1)
  duration: number;

  @IsString()
  endpoint: string;

  @IsOptional()
  @IsString()
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  @IsOptional()
  payload?: Record<string, any>;
}

export class PerformanceThresholds {
  @IsNumber()
  @Min(0)
  maxResponseTime: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  maxErrorRate: number;

  @IsNumber()
  @Min(0)
  minThroughput: number;
}

export class StressTestConfigDto {
  @IsString()
  testName: string;

  @IsArray()
  profiles: VirtualProfile[];

  @IsOptional()
  thresholds?: PerformanceThresholds;

  @IsOptional()
  @IsNumber()
  @Min(1)
  rampUpTime?: number;

  @IsOptional()
  @IsBoolean()
  enableAlerts?: boolean;
}
