import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import {
  StressTestConfigDto,
  VirtualProfile,
  PerformanceThresholds,
} from './dto/stress-test-config.dto';
import {
  StressTestResult,
  ProfileResult,
  PerformanceMetrics,
  Alert,
} from './interfaces/stress-test-result.interface';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '../config/config.service';

@Injectable()
export class StressTestService {
  private readonly logger = new Logger(StressTestService.name);
  private activeTests = new Map<string, StressTestResult>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /** Executes configured virtual-user profiles and returns aggregate load metrics. */
  async runStressTest(config: StressTestConfigDto): Promise<StressTestResult> {
    const testId = this.generateTestId();
    this.logger.log(`Starting stress test: ${config.testName} (ID: ${testId})`);

    const result: StressTestResult = {
      testId,
      testName: config.testName,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      profileResults: [],
      overallMetrics: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        overallErrorRate: 0,
        overallThroughput: 0,
      },
      alerts: [],
      status: 'COMPLETED',
    };

    this.activeTests.set(testId, result);

    try {
      for (let i = 0; i < config.profiles.length; i++) {
        const profile = config.profiles[i];
        this.logger.log(`Executing profile ${i + 1}/${config.profiles.length}`);

        const profileResult = await this.executeProfile(
          profile,
          i,
          config.thresholds,
          config.enableAlerts ?? true,
        );

        result.profileResults.push(profileResult);
      }

      this.calculateOverallMetrics(result);
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      result.status = 'COMPLETED';

      this.logger.log(`Stress test completed: ${config.testName}`);
      this.logAlerts(result.alerts);
    } catch (error: unknown) {
      result.status = 'FAILED';
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Stress test failed: ${err.message}`, err.stack);
    }

    this.activeTests.delete(testId);
    return result;
  }

  private async executeProfile(
    profile: VirtualProfile,
    profileIndex: number,
    thresholds?: PerformanceThresholds,
    enableAlerts = true,
  ): Promise<ProfileResult> {
    const metrics: PerformanceMetrics[] = [];
    const baseUrl =
      this.configService.get('API_BASE_URL') || 'http://localhost:3000';
    const url = `${baseUrl}${profile.endpoint}`;

    this.logger.log(
      `Profile ${profileIndex}: ${profile.concurrentUsers} concurrent users, ` +
        `${profile.requestsPerSecond} req/s, duration: ${profile.duration}s`,
    );

    const workers = Math.min(profile.concurrentUsers, 100);
    const requestsPerWorker = Math.ceil(
      (profile.requestsPerSecond * profile.duration) / workers,
    );

    const promises: Promise<void>[] = [];

    for (let w = 0; w < workers; w++) {
      promises.push(
        this.runWorker(
          url,
          profile.method || 'GET',
          profile.payload,
          requestsPerWorker,
          metrics,
        ),
      );
    }

    await Promise.all(promises);

    const result = this.calculateProfileMetrics(
      metrics,
      profileIndex,
      profile.duration,
    );

    if (thresholds && enableAlerts) {
      result.alerts = this.checkThresholds(result, thresholds);
    }

    return result;
  }

  private async runWorker(
    url: string,
    method: string,
    payload: Record<string, any> | undefined,
    requestCount: number,
    metrics: PerformanceMetrics[],
  ): Promise<void> {
    for (let i = 0; i < requestCount; i++) {
      const startTime = Date.now();

      try {
        const response = await firstValueFrom(
          this.httpService.request({
            method,
            url,
            data: payload,
            timeout: 30000,
          }),
        );

        const responseTime = Date.now() - startTime;

        metrics.push({
          timestamp: startTime,
          responseTime,
          statusCode: response.status,
          success: response.status >= 200 && response.status < 300,
        });
      } catch (error: unknown) {
        const responseTime = Date.now() - startTime;
        const axiosErr = error as {
          response?: { status?: number };
          message?: string;
        };
        metrics.push({
          timestamp: startTime,
          responseTime,
          statusCode: axiosErr.response?.status || 0,
          success: false,
          error: axiosErr.message,
        });
      }
    }
  }

  private calculateProfileMetrics(
    metrics: PerformanceMetrics[],
    profileIndex: number,
    duration: number,
  ): ProfileResult {
    const successful = metrics.filter((m) => m.success);
    const failed = metrics.filter((m) => !m.success);
    const responseTimes = metrics
      .map((m) => m.responseTime)
      .sort((a, b) => a - b);

    const totalRequests = metrics.length;
    const successfulRequests = successful.length;
    const failedRequests = failed.length;
    const averageResponseTime =
      responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const minResponseTime = responseTimes[0] || 0;
    const maxResponseTime = responseTimes[responseTimes.length - 1] || 0;

    const p50Index = Math.floor(responseTimes.length * 0.5);
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);

    const p50ResponseTime = responseTimes[p50Index] || 0;
    const p95ResponseTime = responseTimes[p95Index] || 0;
    const p99ResponseTime = responseTimes[p99Index] || 0;

    const throughput = totalRequests / duration;
    const errorRate = (failedRequests / totalRequests) * 100;

    return {
      profileIndex,
      totalRequests,
      successfulRequests,
      failedRequests,
      averageResponseTime,
      minResponseTime,
      maxResponseTime,
      p50ResponseTime,
      p95ResponseTime,
      p99ResponseTime,
      throughput,
      errorRate,
      metrics,
      alerts: [],
    };
  }

  private checkThresholds(
    profile: ProfileResult,
    thresholds: PerformanceThresholds,
  ): Alert[] {
    const alerts: Alert[] = [];
    const timestamp = Date.now();

    if (profile.averageResponseTime > thresholds.maxResponseTime) {
      alerts.push({
        timestamp,
        type: 'PERFORMANCE_DROP',
        severity: 'CRITICAL',
        message: `Average response time ${profile.averageResponseTime.toFixed(2)}ms exceeds threshold ${thresholds.maxResponseTime}ms`,
        metric: 'averageResponseTime',
        value: profile.averageResponseTime,
        threshold: thresholds.maxResponseTime,
      });
    }

    if (profile.errorRate > thresholds.maxErrorRate) {
      alerts.push({
        timestamp,
        type: 'ERROR_RATE',
        severity: 'CRITICAL',
        message: `Error rate ${profile.errorRate.toFixed(2)}% exceeds threshold ${thresholds.maxErrorRate}%`,
        metric: 'errorRate',
        value: profile.errorRate,
        threshold: thresholds.maxErrorRate,
      });
    }

    if (profile.throughput < thresholds.minThroughput) {
      alerts.push({
        timestamp,
        type: 'THROUGHPUT_DROP',
        severity: 'WARNING',
        message: `Throughput ${profile.throughput.toFixed(2)} req/s below threshold ${thresholds.minThroughput} req/s`,
        metric: 'throughput',
        value: profile.throughput,
        threshold: thresholds.minThroughput,
      });
    }

    return alerts;
  }

  private calculateOverallMetrics(result: StressTestResult): void {
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;

    for (const profile of result.profileResults) {
      totalRequests += profile.totalRequests;
      successfulRequests += profile.successfulRequests;
      failedRequests += profile.failedRequests;

      for (const metric of profile.metrics) {
        totalResponseTime += metric.responseTime;
        responseTimeCount++;
      }

      result.alerts.push(...profile.alerts);
    }

    const totalDuration =
      result.profileResults.reduce(
        (sum, p) =>
          sum + p.metrics.length > 0
            ? (p.metrics[p.metrics.length - 1].timestamp -
                p.metrics[0].timestamp) /
              1000
            : 0,
        0,
      ) || result.profileResults.reduce((sum) => sum + 60, 0);

    result.overallMetrics = {
      totalRequests,
      successfulRequests,
      failedRequests,
      averageResponseTime:
        responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0,
      overallErrorRate:
        totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0,
      overallThroughput: totalDuration > 0 ? totalRequests / totalDuration : 0,
    };
  }

  private logAlerts(alerts: Alert[]): void {
    if (alerts.length === 0) {
      this.logger.log('[OK] No performance alerts generated');
      return;
    }

    this.logger.warn(`[WARN] Generated ${alerts.length} performance alerts:`);

    for (const alert of alerts) {
      const prefix = alert.severity === 'CRITICAL' ? '[CRIT]' : '[WARN]';
      this.logger.warn(
        `${prefix} [${alert.type}] ${alert.message} (Value: ${alert.value.toFixed(2)}, Threshold: ${alert.threshold})`,
      );
    }
  }

  /** Returns a currently running stress test by ID when present. */
  getActiveTest(testId: string): StressTestResult | undefined {
    return this.activeTests.get(testId);
  }

  /** Returns all currently running stress tests. */
  getAllActiveTests(): StressTestResult[] {
    return Array.from(this.activeTests.values());
  }

  private generateTestId(): string {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
