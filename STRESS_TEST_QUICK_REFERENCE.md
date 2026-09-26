# StressTestService #729 — Quick Reference

## What Was Done
Added 16 comprehensive test cases to cover all 6 uncovered branches in the stress test service.

## File Created
`test/unit/stress-test.service.spec.ts` — 16 new test cases covering all thresholds and fallbacks

## The 6 Branches Covered

### 1. `if (profile.averageResponseTime > thresholds.maxResponseTime)` — 2 tests
Generates PERFORMANCE_DROP alert when breached.
- Breached: ✅
- Not breached: ✅

### 2. `if (profile.errorRate > thresholds.maxErrorRate)` — 2 tests
Generates ERROR_RATE alert when breached.
- Breached: ✅
- Not breached: ✅

### 3. `if (profile.throughput < thresholds.minThroughput)` — 2 tests
Generates THROUGHPUT_DROP alert when breached.
- Breached: ✅
- Not breached: ✅

### 4. `enableAlerts ?? true` Default Argument — 4 tests
Controls whether threshold checks run.
- Undefined (defaults true): ✅
- False: ✅
- True: ✅
- Effects on threshold checking: ✅

### 5. `configService.get('API_BASE_URL') || 'http://localhost:3000'` Fallback — 3 tests
Constructs the request base URL.
- Set: ✅
- Unset: ✅
- Empty string: ✅

### 6. `profile.method || 'GET'` Fallback — 3 tests
Determines HTTP method for requests.
- Provided: ✅
- Not provided: ✅
- Various methods (POST, PUT, DELETE, PATCH): ✅

## Test Patterns

**Alert Threshold Breached:**
```typescript
const thresholds: PerformanceThresholds = {
  maxResponseTime: 1, // Very low threshold
  maxErrorRate: 5,
  minThroughput: 10000,
};
// ... run test ...
// Alert should be triggered
```

**enableAlerts Control:**
```typescript
const config: StressTestConfigDto = {
  testName: 'test',
  profiles: [...],
  thresholds,
  enableAlerts: false, // No alerts collected
};
```

**Config Fallback:**
```typescript
configService.get.mockReturnValue(undefined); // API_BASE_URL not set
// Falls back to 'http://localhost:3000'
```

## Coverage Summary

| Branch | Tests | Status |
|--------|-------|--------|
| maxResponseTime breach | 2 | ✅ |
| maxErrorRate breach | 2 | ✅ |
| minThroughput breach | 2 | ✅ |
| enableAlerts default | 4 | ✅ |
| API_BASE_URL fallback | 3 | ✅ |
| profile.method fallback | 3 | ✅ |
| **Total** | **16** | **6 ✅** |

## Running Tests

```bash
# All tests
npm test

# Stress test only
npm test -- test/unit/stress-test.service.spec.ts

# With coverage
npm run test:cov -- test/unit/stress-test.service.spec.ts

# Check thresholds
npm run check-coverage
```

## Key Points

- ✅ All 6 branches have direct test coverage
- ✅ Each condition tested in both trigger and non-trigger states
- ✅ Mocked HTTP to avoid actual network I/O
- ✅ Alert generation verified
- ✅ Config fallbacks verified
- ✅ Method defaults verified

All uncovered branches now have explicit test coverage with observable behavior assertions.
