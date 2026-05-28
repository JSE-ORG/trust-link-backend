#!/usr/bin/env ts-node
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface VirtualProfile {
  concurrentUsers: number;
  requestsPerSecond: number;
  duration: number;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  payload?: Record<string, any>;
}

interface PerformanceThresholds {
  maxResponseTime: number;
  maxErrorRate: number;
  minThroughput: number;
}

interface StressTestConfig {
  testName: string;
  profiles: VirtualProfile[];
  thresholds?: PerformanceThresholds;
  enableAlerts?: boolean;
  rampUpTime?: number;
  baseUrl?: string;
}

interface PerformanceMetrics {
  timestamp: number;
  responseTime: number;
  statusCode: number;
  success: boolean;
  error?: string;
}

interface Alert {
  timestamp: number;
  type: 'PERFORMANCE_DROP' | 'ERROR_RATE' | 'THROUGHPUT_DROP';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

interface ProfileResult {
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

class StressTestRunner {
  private config: StressTestConfig;
  private baseUrl: string;

  constructor(configPath: string) {
    const configData = fs.readFileSync(configPath, 'utf-8');
    this.config = JSON.parse(configData);
    this.baseUrl = this.config.baseUrl || 'http://localhost:3000';
  }

  async run(): Promise<void> {
    console.log(`\n🚀 Starting stress test: ${this.config.testName}`);
    console.log(`📍 Target URL: ${this.baseUrl}`);
    console.log(`📊 Profiles: ${this.config.profiles.length}\n`);

    const results: ProfileResult[] = [];
    const startTime = Date.now();

    for (let i = 0; i < this.config.profiles.length; i++) {
      const profile = this.config.profiles[i];
      console.log(`\n📈 Executing profile ${i + 1}/${this.config.profiles.length}`);
      console.log(`   Concurrent Users: ${profile.concurrentUsers}`);
      console.log(`   Requests/Second: ${profile.requestsPerSecond}`);
      console.log(`   Duration: ${profile.duration}s`);
      console.log(`   Endpoint: ${profile.method || 'GET'} ${profile.endpoint}\n`);

      const result = await this.executeProfile(profile, i);
      results.push(result);
      this.printProfileResult(result);
    }

    const endTime = Date.now();
    const totalDuration = (endTime - startTime) / 1000;

    this.printOverallSummary(results, totalDuration);
    this.generateReport(results, totalDuration);
  }

  private async executeProfile(profile: VirtualProfile, profileIndex: number): Promise<ProfileResult> {
    const metrics: PerformanceMetrics[] = [];
    const url = `${this.baseUrl}${profile.endpoint}`;
    
    const workers = Math.min(profile.concurrentUsers, 100);
    const requestsPerWorker = Math.ceil(
      (profile.requestsPerSecond * profile.duration) / workers,
    );

    const promises: Promise<void>[] = [];

    for (let w = 0; w < workers; w++) {
      promises.push(
        this.runWorker(url, profile.method || 'GET', profile.payload, requestsPerWorker, metrics),
      );
    }

    await Promise.all(promises);

    const result = this.calculateProfileMetrics(metrics, profileIndex, profile.duration);
    
    if (this.config.thresholds && this.config.enableAlerts) {
      result.alerts = this.checkThresholds(result, this.config.thresholds);
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
        const response = await axios({
          method,
          url,
          data: payload,
          timeout: 30000,
          validateStatus: () => true,
        });

        const responseTime = Date.now() - startTime;
        
        metrics.push({
          timestamp: startTime,
          responseTime,
          statusCode: response.status,
          success: response.status >= 200 && response.status < 300,
        });
      } catch (error: any) {
        const responseTime = Date.now() - startTime;
        
        metrics.push({
          timestamp: startTime,
          responseTime,
          statusCode: error.response?.status || 0,
          success: false,
          error: error.message,
        });
      }
    }
  }

  private calculateProfileMetrics(
    metrics: PerformanceMetrics[],
    profileIndex: number,
    duration: number,
  ): ProfileResult {
    const successful = metrics.filter(m => m.success);
    const failed = metrics.filter(m => !m.success);
    const responseTimes = metrics.map(m => m.responseTime).sort((a, b) => a - b);

    const totalRequests = metrics.length;
    const successfulRequests = successful.length;
    const failedRequests = failed.length;
    const averageResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
      : 0;
    const minResponseTime = responseTimes[0] || 0;
    const maxResponseTime = responseTimes[responseTimes.length - 1] || 0;

    const p50Index = Math.floor(responseTimes.length * 0.5);
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);

    const p50ResponseTime = responseTimes[p50Index] || 0;
    const p95ResponseTime = responseTimes[p95Index] || 0;
    const p99ResponseTime = responseTimes[p99Index] || 0;

    const throughput = totalRequests / duration;
    const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;

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

  private checkThresholds(profile: ProfileResult, thresholds: PerformanceThresholds): Alert[] {
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

  private printProfileResult(result: ProfileResult): void {
    console.log(`\n📊 Profile ${result.profileIndex + 1} Results:`);
    console.log(`   Total Requests: ${result.totalRequests}`);
    console.log(`   ✅ Successful: ${result.successfulRequests}`);
    console.log(`   ❌ Failed: ${result.failedRequests}`);
    console.log(`   📈 Throughput: ${result.throughput.toFixed(2)} req/s`);
    console.log(`   ⏱️  Avg Response Time: ${result.averageResponseTime.toFixed(2)}ms`);
    console.log(`   ⏱️  P50: ${result.p50ResponseTime.toFixed(2)}ms`);
    console.log(`   ⏱️  P95: ${result.p95ResponseTime.toFixed(2)}ms`);
    console.log(`   ⏱️  P99: ${result.p99ResponseTime.toFixed(2)}ms`);
    console.log(`   📉 Error Rate: ${result.errorRate.toFixed(2)}%`);

    if (result.alerts.length > 0) {
      console.log(`\n   ⚠️  Alerts: ${result.alerts.length}`);
      for (const alert of result.alerts) {
        const emoji = alert.severity === 'CRITICAL' ? '🚨' : '⚠️';
        console.log(`      ${emoji} [${alert.type}] ${alert.message}`);
      }
    } else {
      console.log(`   ✅ No alerts`);
    }
  }

  private printOverallSummary(results: ProfileResult[], totalDuration: number): void {
    const totalRequests = results.reduce((sum, r) => sum + r.totalRequests, 0);
    const successfulRequests = results.reduce((sum, r) => sum + r.successfulRequests, 0);
    const failedRequests = results.reduce((sum, r) => sum + r.failedRequests, 0);
    const allAlerts = results.flatMap(r => r.alerts);

    console.log(`\n\n🎯 Overall Summary:`);
    console.log(`   Total Duration: ${totalDuration.toFixed(2)}s`);
    console.log(`   Total Requests: ${totalRequests}`);
    console.log(`   ✅ Successful: ${successfulRequests}`);
    console.log(`   ❌ Failed: ${failedRequests}`);
    console.log(`   📈 Overall Throughput: ${(totalRequests / totalDuration).toFixed(2)} req/s`);
    console.log(`   📉 Overall Error Rate: ${((failedRequests / totalRequests) * 100).toFixed(2)}%`);
    console.log(`   ⚠️  Total Alerts: ${allAlerts.length}`);

    if (allAlerts.length > 0) {
      const criticalAlerts = allAlerts.filter(a => a.severity === 'CRITICAL').length;
      console.log(`      🚨 Critical: ${criticalAlerts}`);
      console.log(`      ⚠️  Warnings: ${allAlerts.length - criticalAlerts}`);
    }
  }

  private generateReport(results: ProfileResult[], totalDuration: number): void {
    const report = {
      testName: this.config.testName,
      startTime: new Date().toISOString(),
      duration: totalDuration,
      profiles: results.map(r => ({
        profileIndex: r.profileIndex,
        totalRequests: r.totalRequests,
        successfulRequests: r.successfulRequests,
        failedRequests: r.failedRequests,
        throughput: r.throughput,
        averageResponseTime: r.averageResponseTime,
        p50ResponseTime: r.p50ResponseTime,
        p95ResponseTime: r.p95ResponseTime,
        p99ResponseTime: r.p99ResponseTime,
        errorRate: r.errorRate,
        alerts: r.alerts,
      })),
      overall: {
        totalRequests: results.reduce((sum, r) => sum + r.totalRequests, 0),
        successfulRequests: results.reduce((sum, r) => sum + r.successfulRequests, 0),
        failedRequests: results.reduce((sum, r) => sum + r.failedRequests, 0),
        throughput: results.reduce((sum, r) => sum + r.totalRequests, 0) / totalDuration,
        errorRate: (results.reduce((sum, r) => sum + r.failedRequests, 0) / 
                    results.reduce((sum, r) => sum + r.totalRequests, 0)) * 100,
        totalAlerts: results.flatMap(r => r.alerts).length,
      },
    };

    const reportPath = path.join(process.cwd(), `stress-test-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Report saved to: ${reportPath}`);
  }
}

// Main execution
const configPath = process.argv[2] || './stress-test.config.json';
const runner = new StressTestRunner(configPath);
runner.run().catch(console.error);
