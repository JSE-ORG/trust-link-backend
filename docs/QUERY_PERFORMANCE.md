# Query Performance Analysis

## Purpose

Issue #99 requires repeatable `EXPLAIN ANALYZE` checks for primary application query layers and direct optimization of heavy sequential scans. This document maps the important query paths, the analysis commands, and the indexes added to keep production reads predictable as tables grow.

## Query Paths Covered

| Area | Code path | Query shape | Optimization target |
| --- | --- | --- | --- |
| Duplicate escrow check | `EscrowRepository.findByVendorAndItem` | `vendorAddress + itemRef` | Composite lookup index |
| Vendor escrow list | `EscrowRepository.findVendorEscrows` | `vendorAddress + state`, sorted by date or amount | Existing `vendorAddress,state` index plus query-profile checks |
| Buyer escrow list | `EscrowRepository.findByBuyer` | `buyerAddress` | Existing buyer lookup index |
| Shipment polling | `EscrowRepository.findShippedWithTracking` | `state = SHIPPED`, `trackingId IS NOT NULL` | State/tracking partial workload index |
| Admin stats | `AdminStatsService.getStats` | Full escrow and dispute reads | Analysis documents the full scan cost; aggregation should move to DB-level counts when volume grows |
| Dispute lookup | `DisputeRepository.findByEscrow` | `escrowId` | Escrow dispute lookup index |
| Notification history | Notification relation reads | `escrowId` | Notification relation index |

## How To Run Analysis

Run the SQL script against a staging database populated with production-like data:

```bash
psql "$DATABASE_URL" -f scripts/query-performance.sql
```

Each query uses `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` so the output includes timing, buffer activity, join strategy, and whether PostgreSQL chose sequential or index scans.

## Vendor Dashboard Index Verification

Issue #309 tracks the vendor dashboard endpoint (`GET /vendor/escrows`). The repository method `EscrowRepository.findVendorEscrows` always filters by `vendorAddress` and optionally narrows by `state`, so the Prisma schema includes:

```prisma
@@index([vendorAddress, state])
```

The index is named `Escrow_vendorAddress_state_idx` in PostgreSQL. It is created by the historical `20260529000000_security_updates` migration and guarded by the idempotent `20260701000000_vendor_dashboard_vendor_state_index` migration.

Use the `vendor_escrows_by_state_recent` probe in `scripts/query-performance.sql` to verify the filtered dashboard path:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Escrow"
WHERE "vendorAddress" = '<vendor-address>'
  AND "state" = 'SHIPPED'
ORDER BY "createdAt" DESC
LIMIT 20;
```

On a populated staging database, the expected plan should include an index-backed scan such as `Index Scan`, `Bitmap Index Scan`, or a low-cost plan that references `Escrow_vendorAddress_state_idx`. Record the total execution time and buffer reads before and after deploying the migration.

For a before/after benchmark on staging only, wrap the "without index" measurement in a transaction so the index drop is rolled back:

```sql
BEGIN;
DROP INDEX IF EXISTS "Escrow_vendorAddress_state_idx";
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Escrow"
WHERE "vendorAddress" = '<vendor-address>'
  AND "state" = 'SHIPPED'
ORDER BY "createdAt" DESC
LIMIT 20;
ROLLBACK;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Escrow"
WHERE "vendorAddress" = '<vendor-address>'
  AND "state" = 'SHIPPED'
ORDER BY "createdAt" DESC
LIMIT 20;
```

## Bottleneck Documentation

Record each run in the task tracker with:

- Database size: escrow, dispute, and notification row counts.
- Slow query text and route or worker that triggered it.
- Plan summary: scan type, rows removed by filter, buffer hits, buffer reads, and total time.
- Decision: add or adjust index, rewrite query, add pagination, or accept full scan.
- Verification: post-change plan showing lower cost or index usage.

## Indexes Added

The vendor dashboard index is present from `20260529000000_security_updates` and is guarded by `20260701000000_vendor_dashboard_vendor_state_index`:

- `Escrow_vendorAddress_state_idx` for the vendor dashboard path (`vendorAddress + state`).

The `20260529170000_query_performance_indexes` migration adds:

- `Escrow_vendorAddress_itemRef_idx` for duplicate escrow detection.
- `Escrow_state_trackingId_idx` for shipment polling.
- `Escrow_state_createdAt_idx` for state-scoped chronological reads.
- `Dispute_escrowId_idx` for escrow dispute lookups.
- `Notification_escrowId_idx` for notification relation reads.

These indexes target the highest-risk sequential scans without adding broad indexes that would slow every write.

