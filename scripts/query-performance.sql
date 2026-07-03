-- Issue #99: repeatable EXPLAIN ANALYZE probes for Trust-Link query paths.
-- Run against staging or a production snapshot:
--   psql "$DATABASE_URL" -f scripts/query-performance.sql

\\timing on

SELECT 'escrow_duplicate_vendor_item_ref' AS probe;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Escrow"
WHERE "vendorAddress" = 'GD3W57WQA63W6V5P2K7G2RD4M4JYZ736H72Z5TQX6Z62S7H3L2B2J5V6'
  AND "itemRef" = 'REF-DET-1000'
LIMIT 1;

SELECT 'vendor_escrows_by_state_recent' AS probe;
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'Escrow'
  AND indexname = 'Escrow_vendorAddress_state_idx';

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Escrow"
WHERE "vendorAddress" = 'GD3W57WQA63W6V5P2K7G2RD4M4JYZ736H72Z5TQX6Z62S7H3L2B2J5V6'
  AND "state" = 'SHIPPED'
ORDER BY "createdAt" DESC
LIMIT 20;

SELECT 'vendor_escrows_all_states_recent' AS probe;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Escrow"
WHERE "vendorAddress" = 'GD3W57WQA63W6V5P2K7G2RD4M4JYZ736H72Z5TQX6Z62S7H3L2B2J5V6'
ORDER BY "createdAt" DESC
LIMIT 20;

SELECT 'buyer_escrows' AS probe;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Escrow"
WHERE "buyerAddress" = 'GDBW53QA46TQX6S7D67V72Z5TQX6Z62S7H3L2B2J5V6BUY18274L2P';

SELECT 'shipment_polling_candidates' AS probe;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Escrow"
WHERE "state" = 'SHIPPED'
  AND "trackingId" IS NOT NULL;

SELECT 'dispute_by_escrow' AS probe;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Dispute"
WHERE "escrowId" = 'example-escrow-id'
LIMIT 1;

SELECT 'notifications_by_escrow' AS probe;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM "Notification"
WHERE "escrowId" = 'example-escrow-id'
ORDER BY "createdAt" DESC;

SELECT 'admin_stats_full_table_cost' AS probe;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT "state", COUNT(*) AS escrow_count, SUM("amount") AS total_amount
FROM "Escrow"
GROUP BY "state";

