# Stress Testing System

A scalable system stress check program that tracks performance limits under simulated high-concurrency traffic conditions.

## Features

- **Concurrent Request Simulation**: Execute multiple virtual profiles with configurable concurrent users and request rates
- **Performance Metrics Tracking**: Monitor response times, throughput, and error rates in real-time
- **Alerting System**: Automatic alerts for performance drops, high error rates, and throughput issues
- **Detailed Reports**: Generate comprehensive JSON reports with percentile metrics
- **Flexible Configuration**: Customize test profiles, thresholds, and endpoints

## Installation

First, install the required dependencies:

```bash
npm install
```

## Usage

### CLI Stress Test Runner

The standalone CLI runner can be used without starting the NestJS application:

```bash
# Run with default configuration
npm run stress:test

# Run with custom configuration
npm run stress:test:config ./custom-config.json
```

### API Endpoints

When the NestJS application is running, you can use the following endpoints:

#### Start a Stress Test

These stress-test endpoints are admin-only. They require a valid bearer JWT and an admin role. Unauthenticated requests receive 401 and non-admin JWTs receive 403.

```bash
POST /stress-test
Content-Type: application/json

{
  "testName": "API Load Test",
  "profiles": [
    {
      "concurrentUsers": 10,
      "requestsPerSecond": 50,
      "duration": 30,
      "endpoint": "/api/health",
      "method": "GET"
    }
  ],
  "thresholds": {
    "maxResponseTime": 1000,
    "maxErrorRate": 5,
    "minThroughput": 100
  },
  "enableAlerts": true
}
```

#### Get Active Test Status

```bash
GET /stress-test/active/:testId
```

#### Get All Active Tests

```bash
GET /stress-test/active
```

## Configuration

### Test Configuration Structure

```json
{
  "testName": "API Load Test",
  "baseUrl": "http://localhost:3000",
  "profiles": [
    {
      "concurrentUsers": 10,
      "requestsPerSecond": 50,
      "duration": 30,
      "endpoint": "/api/health",
      "method": "GET",
      "payload": {}
    }
  ],
  "thresholds": {
    "maxResponseTime": 1000,
    "maxErrorRate": 5,
    "minThroughput": 100
  },
  "enableAlerts": true,
  "rampUpTime": 5
}
```

### Configuration Parameters

- **testName**: Name of the stress test
- **baseUrl**: Target API base URL (default: http://localhost:3000)
- **profiles**: Array of virtual user profiles
  - **concurrentUsers**: Number of concurrent virtual users (1-10000)
  - **requestsPerSecond**: Target requests per second
  - **duration**: Test duration in seconds
  - **endpoint**: API endpoint to test
  - **method**: HTTP method (GET, POST, PUT, DELETE, PATCH)
  - **payload**: Request body for POST/PUT requests
- **thresholds**: Performance thresholds for alerts
  - **maxResponseTime**: Maximum acceptable response time in ms
  - **maxErrorRate**: Maximum acceptable error rate percentage
  - **minThroughput**: Minimum acceptable throughput in req/s
- **enableAlerts**: Enable/disable performance alerts
- **rampUpTime**: Time to gradually increase load (seconds)

## Performance Metrics

The system tracks the following metrics for each profile:

- **Total Requests**: Total number of requests sent
- **Successful Requests**: Number of successful responses (2xx status codes)
- **Failed Requests**: Number of failed responses
- **Throughput**: Requests per second
- **Average Response Time**: Mean response time across all requests
- **Percentile Response Times**: P50, P95, P99 response times
- **Error Rate**: Percentage of failed requests

## Alerts

The system generates alerts when performance thresholds are exceeded:

### Alert Types

1. **PERFORMANCE_DROP** (CRITICAL)
   - Triggered when average response time exceeds threshold
   - Example: Average response time 1500ms exceeds threshold 1000ms

2. **ERROR_RATE** (CRITICAL)
   - Triggered when error rate exceeds threshold
   - Example: Error rate 8.5% exceeds threshold 5%

3. **THROUGHPUT_DROP** (WARNING)
   - Triggered when throughput falls below threshold
   - Example: Throughput 80 req/s below threshold 100 req/s

## Reports

After each test run, a detailed JSON report is generated:

```bash
stress-test-report-1234567890.json
```

The report includes:
- Test metadata (name, start time, duration)
- Per-profile metrics and alerts
- Overall summary statistics
- Detailed performance data

## Example Configuration Files

### Light Load Test

```json
{
  "testName": "Light Load Test",
  "profiles": [
    {
      "concurrentUsers": 5,
      "requestsPerSecond": 20,
      "duration": 30,
      "endpoint": "/api/health",
      "method": "GET"
    }
  ],
  "thresholds": {
    "maxResponseTime": 500,
    "maxErrorRate": 1,
    "minThroughput": 50
  },
  "enableAlerts": true
}
```

### Heavy Load Test

```json
{
  "testName": "Heavy Load Test",
  "profiles": [
    {
      "concurrentUsers": 100,
      "requestsPerSecond": 500,
      "duration": 120,
      "endpoint": "/api/escrow",
      "method": "GET"
    },
    {
      "concurrentUsers": 200,
      "requestsPerSecond": 1000,
      "duration": 180,
      "endpoint": "/api/vendor",
      "method": "GET"
    }
  ],
  "thresholds": {
    "maxResponseTime": 2000,
    "maxErrorRate": 10,
    "minThroughput": 200
  },
  "enableAlerts": true
}
```

## Acceptance Criteria

✅ **Execution tests trace response behaviors across target concurrent virtual profiles**
- Multiple virtual profiles can be configured with different concurrency levels
- Each profile tracks detailed response metrics (times, status codes, errors)
- Percentile metrics (P50, P95, P99) provide insight into response distribution

✅ **System alerts flag performance drops or processing errors clearly**
- Automatic alerts when response times exceed thresholds
- Error rate alerts when failure rates are too high
- Throughput alerts when system capacity is insufficient
- Clear severity levels (CRITICAL, WARNING) with descriptive messages

## Best Practices

1. **Start Small**: Begin with light load tests to establish baseline performance
2. **Gradual Increase**: Use multiple profiles to gradually increase load
3. **Monitor Resources**: Watch CPU, memory, and network during tests
4. **Set Realistic Thresholds**: Base thresholds on your SLA requirements
5. **Review Reports**: Analyze detailed reports to identify bottlenecks
6. **Test Regularly**: Incorporate stress testing into your CI/CD pipeline

## Troubleshooting

### Connection Refused
- Ensure the target API server is running
- Check the baseUrl configuration matches your server address

### High Error Rates
- Verify endpoints are accessible and correctly configured
- Check authentication/authorization requirements
- Review server logs for error details

### Performance Degradation
- Monitor server resources during tests
- Check database connection pool settings
- Review rate limiting configurations
