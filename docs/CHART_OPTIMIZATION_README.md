# Chart Endpoint Optimization

## Overview

Optimized the chart endpoint to use database-level aggregation instead of loading all transactions into memory and aggregating in JavaScript. This significantly improves performance and reduces memory usage for large datasets.

## Changes Made

### 1. Database-Level Aggregation (`analytics.service.ts`)

**Before:**
- Loaded all transactions into memory using `findMany`
- Aggregated data in JavaScript using Map
- Calculated metrics in application code

**After:**
- Uses raw SQL with `$queryRaw` for database-level aggregation
- Aggregates data at the database level using `GROUP BY` and `SUM/COUNT`
- Only processes aggregated results in JavaScript

### 2. Timezone Support

- Added `timezone` parameter to handle date grouping across timezone boundaries
- Uses PostgreSQL's `AT TIME ZONE` for correct date conversion
- Default timezone is UTC for backward compatibility

### 3. Gap Filling and Interval Bucketing

- Implemented `fillDateGaps` method to fill periods with zero transactions across all intervals:
  - `day` (default): Daily calendar steps.
  - `week`: Monday-start week bucketing (`DATE_TRUNC('week', ...)`), ensuring ISO week alignment and 7-day increments.
  - `month`: Monthly bucketing aligned to the 1st of each calendar month (`DATE_TRUNC('month', ...)`).
- Ensures consistent time-series data even for inactive periods while maintaining chronological order.

### 4. Shipping and Delivery Speed Metrics

- Added fulfillment speed metrics to vendor analytics statistics (`GET /vendor/analytics/stats`):
  - `averageHoursToShip`: Mean elapsed hours between escrow creation (`createdAt`) and shipment (`shippedAt`), computed as `(shippedAt - createdAt) / 3600` when `shippedAt >= createdAt`. Evaluates to `null` when no escrows in the requested window have been shipped.
  - `averageHoursToDeliver`: Mean elapsed hours between shipment (`shippedAt`) and buyer delivery (`deliveredAt`), computed as `(deliveredAt - shippedAt) / 3600` when `deliveredAt >= shippedAt`. Evaluates to `null` when no escrows in the requested window have reached delivery.

### 5. Mock Prisma Service Update (`prisma.service.ts`)

- Added `$queryRaw` mock implementation for testing
- Supports basic aggregation queries
- Maintains compatibility with in-memory test environment

### 6. Controller Update (`analytics.controller.ts`)

- Added optional `timezone` query parameter (defaults to UTC)
- Added optional `interval` query parameter (`day`, `week`, `month`)
- Added optional `from` and `to` date range query parameters (mutually exclusive with `days`)

### 7. Unit Tests (`analytics.service.spec.ts`, `analytics.repository.spec.ts`)

- Tests for database-level aggregation across `day`, `week`, and `month` intervals
- Tests for gap filling functionality and Monday week start
- Tests for shipping and delivery duration metrics including `null` cases
- Tests for timezone boundary handling
- Tests for correct aggregation calculations

### 8. Performance Benchmark (`scripts/benchmark-chart-aggregation.ts`)

- Compares old vs new approach
- Measures execution time and memory usage
- Tests with varying record counts (100, 500, 1000, 5000)

## SQL Query

The optimized chart query uses PostgreSQL's `DATE_TRUNC` and aggregation functions, adapting dynamically to the selected interval (`day`, `week`, or `month`):

```sql
SELECT 
  DATE_TRUNC(${interval}, ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date as date,
  COALESCE(SUM("amount"), 0) as "totalVolume",
  COUNT(*) as "transactionCount",
  SUM(CASE WHEN "state" IN ('COMPLETED', 'RELEASED') THEN 1 ELSE 0 END) as "completedCount",
  SUM(CASE WHEN "state" = 'DISPUTED' THEN 1 ELSE 0 END) as "disputedCount"
FROM "Escrow"
WHERE 
  "vendorAddress" = ${vendorAddress}
  AND "createdAt" >= ${startDate}
  AND "createdAt" <= ${endDate}
GROUP BY 1
ORDER BY 1 ASC
```

### Speed Metrics SQL Query

Fulfillment duration metrics are computed at the database level:

```sql
SELECT 
  AVG(CASE WHEN "shippedAt" IS NOT NULL AND "shippedAt" >= "createdAt" 
      THEN EXTRACT(EPOCH FROM ("shippedAt" - "createdAt")) / 3600.0 
      ELSE NULL END) as "averageHoursToShip",
  AVG(CASE WHEN "deliveredAt" IS NOT NULL AND "shippedAt" IS NOT NULL AND "deliveredAt" >= "shippedAt" 
      THEN EXTRACT(EPOCH FROM ("deliveredAt" - "shippedAt")) / 3600.0 
      ELSE NULL END) as "averageHoursToDeliver"
FROM "Escrow"
WHERE "vendorAddress" = ${vendorAddress}
  AND "createdAt" >= ${startDate}
  AND "createdAt" <= ${endDate}
```

## Performance Improvements

### Expected Improvements

**For small datasets (< 100 records):**
- Minimal performance difference
- Slight overhead from SQL query parsing

**For medium datasets (100-1000 records):**
- 20-40% faster execution
- 30-50% less memory usage

**For large datasets (> 1000 records):**
- 50-80% faster execution
- 60-90% less memory usage

### Running the Benchmark

```bash
npm run benchmark:chart
```

Or directly:
```bash
ts-node scripts/benchmark-chart-aggregation.ts
```

## API Usage

### Chart Endpoint

#### Request

```http
GET /vendor/analytics/chart?days=30&timezone=America/New_York&interval=week
```

#### Parameters

- `days` (optional): Number of days to retrieve (default: 30, max: 365). Mutually exclusive with `from`/`to`.
- `from` / `to` (optional): Explicit date range window in ISO format (`YYYY-MM-DD`). Mutually exclusive with `days`, max span 366 days.
- `timezone` (optional): Timezone for date grouping (default: `UTC`).
- `interval` (optional): Aggregation interval (`day`, `week`, or `month`; default: `day`).
  - `day`: Standard daily bucketing.
  - `week`: Monday-start weekly bucketing.
  - `month`: Monthly bucketing aligned to the 1st of each calendar month.
  - Zero-transaction periods are gap-filled across all intervals to return continuous series data.

#### Response

```json
{
  "data": [
    {
      "date": "2024-01-01",
      "totalVolume": 1500,
      "transactionCount": 15,
      "completedCount": 12,
      "disputedCount": 1,
      "averageTransactionValue": 100
    }
  ],
  "period": {
    "startDate": "2024-01-01",
    "endDate": "2024-01-30"
  },
  "summary": {
    "totalVolume": 45000,
    "totalTransactions": 450,
    "averageDaily": 1500
  }
}
```

### Stats Endpoint (Fulfillment Speed Metrics)

#### Request

```http
GET /vendor/analytics/stats
```

#### Response

```json
{
  "totalVolume": 45000,
  "totalTransactions": 450,
  "completedTransactions": 400,
  "disputedTransactions": 10,
  "disputeRate": 0.022,
  "averageHoursToShip": 14.5,
  "averageHoursToDeliver": 48.2
}
```

#### Speed Metrics Details

- `averageHoursToShip` (`number | null`): Average hours between escrow creation and shipment dispatch. Returns `null` if no escrows have been shipped.
- `averageHoursToDeliver` (`number | null`): Average hours between shipment dispatch and buyer delivery. Returns `null` if no escrows have been delivered.

## Acceptance Criteria

✅ **Use Prisma groupBy or raw SQL for daily aggregation**
- Implemented using `$queryRaw` with PostgreSQL aggregation functions
- Aggregates data at database level using GROUP BY, SUM, COUNT
- Conditional aggregation for completed/disputed counts

✅ **Ensure correct date grouping across timezone boundaries**
- Added timezone parameter with UTC default
- Uses PostgreSQL's `AT TIME ZONE` for correct date conversion
- Implemented `formatDateInTimezone` helper method

✅ **Handle days with zero transactions (fill gaps)**
- Implemented `fillDateGaps` method
- Iterates through entire date range
- Inserts zero-value entries for missing dates
- Maintains chronological order

✅ **Add unit test for aggregation logic**
- Created comprehensive test suite
- Tests aggregation accuracy
- Tests gap filling
- Tests timezone handling
- Tests edge cases (empty data, single day, etc.)

✅ **Benchmark performance before and after**
- Created benchmark script
- Tests with varying record counts
- Measures execution time and memory usage
- Provides improvement percentages

## Migration Notes

### Database Requirements

- PostgreSQL database with `createdAt` timestamp column
- Index on `(vendorAddress, createdAt)` for optimal performance
- Support for `AT TIME ZONE` function (PostgreSQL 9.3+)

### Backward Compatibility

- Default timezone is UTC (maintains existing behavior)
- Existing API calls without timezone parameter work unchanged
- Response format remains identical

### Testing

Run unit tests:
```bash
npm test -- analytics.service.spec.ts
```

Run benchmark:
```bash
npm run benchmark:chart
```

## Troubleshooting

### Slow Performance

1. Check database indexes: Ensure `(vendorAddress, createdAt)` index exists
2. Verify PostgreSQL version: Requires 9.3+ for `AT TIME ZONE`
3. Check connection pool: Ensure sufficient connections for concurrent requests

### Incorrect Timezone Results

1. Verify timezone string format (e.g., 'America/New_York', 'UTC')
2. Check server timezone settings
3. Test with UTC to isolate timezone issues

### Gap Filling Issues

1. Verify date range calculation
2. Check timezone conversion logic
3. Ensure `fillDateGaps` is called after aggregation

## Future Improvements

- Add caching for frequently accessed date ranges
- Implement incremental updates for real-time dashboards
- Add support for additional aggregation intervals (e.g., hourly)
- Consider materialized views for very large datasets
