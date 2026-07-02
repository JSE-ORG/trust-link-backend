-- Issue #307: Add composite indexes on (state, deliveredAt, autoReleaseSubmittedAt)
-- and (state, deliveredAt, autoReleaseTxHash) to optimise the findAutoReleaseEligible
-- query, which filters on all three columns. Without these indexes the query
-- performs a sequential scan of the Escrow table after the (state, deliveredAt)
-- prefix match; the three-column indexes allow PostgreSQL to satisfy the full
-- WHERE clause with a single index range scan.

CREATE INDEX IF NOT EXISTS "Escrow_state_deliveredAt_autoReleaseSubmittedAt_idx"
ON "Escrow"("state", "deliveredAt", "autoReleaseSubmittedAt");

CREATE INDEX IF NOT EXISTS "Escrow_state_deliveredAt_autoReleaseTxHash_idx"
ON "Escrow"("state", "deliveredAt", "autoReleaseTxHash");
