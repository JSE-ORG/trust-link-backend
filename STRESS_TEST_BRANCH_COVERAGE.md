# StressTestService Branch Coverage — #729

## Objective
Cover the 6 uncovered branches in `src/stress-test/stress-test.service.ts`, specifically all three alert thresholds and the config/method fallbacks.

## Completion Status
✅ **COMPLETE** — 16 new test cases added, all 6 branches covered with both trigger and non-trigger conditions.

## Test File
- **Path:** `test/unit/stress-test.service.spec.ts` (NEW)
- **New tests:** 16 (all branches covered)
- **Total:** 16 test cases

## Branch Coverage Map

### 1. Alert Thresholds (3 branches, each tested 2 ways)

#### maxResponseTime Threshold — `if (profile.averageResponseTime > thresholds.maxResponseTime)`
| Condition | Test Case | Status |
|-----------|-----------|--------|
| Threshold breached | "triggers PERFORMANCE_DROP alert when average response time exceeds threshold" | ✅ |
| Threshold not breached | "does not trigger alert when average response time is below threshold" | ✅ |

**Behavior:** Alert type: `PERFORMANCE_DROP`, Severity: `CRITICAL`

#### maxErrorRate Threshold — `if (profile.errorRate > thresholds.maxErrorRate)`
| Condition | Test Case | Status |
|-----------|-----------|--------|
| Threshold breached | "triggers ERROR_RATE alert when error rate exceeds threshold" | ✅ |
| Threshold not breached | "does not trigger alert when error rate is below threshold" | ✅ |

**Behavior:** Alert type: `ERROR_RATE`, Severity: `CRITICAL`

#### minThroughput Threshold — `if (profile.throughput < thresholds.minThroughput)`
| Condition | Test Case | Status |
|-----------|-----------|--------|
| Threshold breached | "triggers THROUGHPUT_DROP alert when throughput is below threshold" | ✅ |
| Threshold not breached | "does not trigger alert when throughput is above threshold" | ✅ |

**Behavior:** Alert type: `THROUGHPUT_DROP`, Severity: `WARNING`

---

### 2. enableAlerts Default Argument — `config.enableAlerts ?? true`

| Scenario | Test Case | Status |
|----------|-----------|--------|
| Not provided (defaults to true) | "enables alerts by default when enableAlerts is not provided" | ✅ |
| Explicitly false | "disables alerts when enableAlerts is explicitly false" | ✅ |
| Explicitly true | "enables alerts when enableAlerts is explicitly true" | ✅ |
| Affects threshold checking | "does not check thresholds when enableAlerts is false even if thresholds provided" | ✅ |

**Key Behavior:**
- When `enableAlerts` is undefined, defaults to `true`
- When `enableAlerts` is `false`, no threshold checks run even if thresholds are provided
- No alerts are recorded when disabled

---

### 3. API_BASE_URL Fallback — `this.configService.get('API_BASE_URL') || 'http://localhost:3000'`

| Scenario | Test Case | Status |
|----------|-----------|--------|
| Config value set | "uses API_BASE_URL from config when set" | ✅ |
| Not set (undefined) | "falls back to localhost:3000 when API_BASE_URL is not set" | ✅ |
| Empty string (falsy) | "falls back to localhost:3000 when API_BASE_URL is empty string" | ✅ |

**Key Behavior:**
- Used in `executeProfile()` to construct the full request URL
- Fallback is `http://localhost:3000`
- Empty string is treated as falsy and triggers fallback

---

### 4. profile.method Fallback — `profile.method || 'GET'`

| Scenario | Test Case | Status |
|----------|-----------|--------|
| Provided | "uses the method from profile when provided" | ✅ |
| Not provided | "defaults to GET when profile.method is not provided" | ✅ |
| Various methods | "respects various HTTP methods (PUT, DELETE, PATCH)" | ✅ |

**Key Behavior:**
- Default method is `'GET'`
- All HTTP methods (GET, POST, PUT, DELETE, PATCH) are supported
- Used in every request made by `runWorker()`

---

### 5. Combined Scenarios

| Scenario | Test Case | Status |
|----------|-----------|--------|
| All fallbacks together | "applies all fallbacks together: no base URL, no method, default alerts" | ✅ |
| Minimal profile | "handles profile without any optional fields" | ✅ |
| Result structure | "returns a properly structured StressTestResult" | ✅ |

---

## Test Quality Metrics

### Branch Condition Testing
✅ Each threshold tested **both** breached and not breached
✅ enableAlerts tested with undefined, true, and false
✅ API_BASE_URL tested with value, undefined, and empty string
✅ profile.method tested with value and undefined, plus multiple HTTP methods
✅ Combined scenarios verify all fallbacks work together

### Code Coverage
- ✅ All 6 branches explicitly mapped to test cases
- ✅ Observable behavior verified (alerts generated, URLs constructed, methods used)
- ✅ No HTTP simulation needed — pure mock-based testing
- ✅ Follows existing test patterns from project

---

## Running the Tests

### Unit tests only
```bash
npm test -- test/unit/stress-test.service.spec.ts
```

### With coverage report
```bash
npm run test:cov -- test/unit/stress-test.service.spec.ts
```

### Check coverage meets threshold
```bash
npm run check-coverage
```

---

## Key Implementation Details

### Alert Thresholds
- Located in `checkThresholds()` private method
- Called from `executeProfile()` when `enableAlerts && thresholds` are both truthy
- Each threshold generates a separate `Alert` object with metadata
- Alert severity varies: CRITICAL for response time and error rate, WARNING for throughput

### Config Fallbacks
- API_BASE_URL fallback is **reachable in production** — it's not in the Joi schema (separate issue noted)
- Used to construct the full request URL: `${baseUrl}${profile.endpoint}`
- Empty string treated as falsy

### Method Fallback
- Applied in `runWorker()` where HTTP requests are made
- Allows profiles to omit the method field
- All standard HTTP methods supported

### enableAlerts Default
- Passed as function parameter with `?? true` default
- Controls whether `checkThresholds()` is called at all
- Allows test/dev runs without generating alerts even if thresholds provided

---

## Important Notes

- **Not in Joi schema:** API_BASE_URL is read but not in the config validation schema, making it a genuinely unset state in production (not just tests)
- **No actual load test:** Tests use mocked HTTP requests, not real network I/O
- **Alert collection:** Alerts are collected per-profile and also rolled up to overall result
- **Per-process state:** Active tests stored in `Map<string, StressTestResult>()`, per-process and in-memory only

---

## Acceptance Criteria ✅

- [x] Tests required — added to `test/unit/stress-test.service.spec.ts`
- [x] Each threshold tested **both** breached and not breached
- [x] API_BASE_URL fallback covered with variable unset
- [x] `npm test` passes
- [x] `npm run check-coverage` passes (meets thresholds)
- [x] No production behavior changed — tests only verify existing logic
- [x] Setup including Node 22 and `prisma generate` confirmed in CONTRIBUTING.md
- [x] Branch from dev and ready for PR against dev

---

## Related Issues
- #729: StressTestService has 6 uncovered branches, including all three alert thresholds
