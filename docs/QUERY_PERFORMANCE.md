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

## Bottleneck Documentation

Record each run in the task tracker with:

- Database size: escrow, dispute, and notification row counts.
- Slow query text and route or worker that triggered it.
- Plan summary: scan type, rows removed by filter, buffer hits, buffer reads, and total time.
- Decision: add or adjust index, rewrite query, add pagination, or accept full scan.
- Verification: post-change plan showing lower cost or index usage.

## Indexes Added

The `20260529170000_query_performance_indexes` migration adds:

- `Escrow_vendorAddress_itemRef_idx` for duplicate escrow detection.
- `Escrow_state_trackingId_idx` for shipment polling.
- `Escrow_state_createdAt_idx` for state-scoped chronological reads.
- `Dispute_escrowId_idx` for escrow dispute lookups.
- `Notification_escrowId_idx` for notification relation reads.

These indexes target the highest-risk sequential scans without adding broad indexes that would slow every write.

