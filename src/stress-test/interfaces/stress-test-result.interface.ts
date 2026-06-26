export interface PerformanceMetrics {
  timestamp: number;
  responseTime: number;
  statusCode: number;
  success: boolean;
  error?: string;
}

export interface ProfileResult {
  profileIndex: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  throughput: number;
  errorRate: number;
  metrics: PerformanceMetrics[];
  alerts: Alert[];
}

export interface Alert {
  timestamp: number;
  type: 'PERFORMANCE_DROP' | 'ERROR_RATE' | 'THROUGHPUT_DROP';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

export interface StressTestResult {
  testId: string;
  testName: string;
  startTime: number;
  endTime: number;
  duration: number;
  profileResults: ProfileResult[];
  overallMetrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    overallErrorRate: number;
    overallThroughput: number;
  };
  alerts: Alert[];
  status: 'COMPLETED' | 'FAILED' | 'INTERRUPTED';
}
