-- Issue #267: Add Prisma indexes for Notification and Dispute performance

-- Ensure Notification has an index on escrowId (idempotent)
CREATE INDEX IF NOT EXISTS "Notification_escrowId_idx"
ON "Notification"("escrowId");

-- Ensure Dispute has an index on status (idempotent)
CREATE INDEX IF NOT EXISTS "Dispute_status_idx"
ON "Dispute"("status");

-- Dispute: new index on resolvedAt for time-range queries on resolution
CREATE INDEX IF NOT EXISTS "Dispute_resolvedAt_idx"
ON "Dispute"("resolvedAt");
