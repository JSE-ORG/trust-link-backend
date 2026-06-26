-- Issue #99: indexes for the highest-volume application query paths.

CREATE INDEX IF NOT EXISTS "Escrow_vendorAddress_itemRef_idx"
ON "Escrow"("vendorAddress", "itemRef");

CREATE INDEX IF NOT EXISTS "Escrow_state_trackingId_idx"
ON "Escrow"("state", "trackingId");

CREATE INDEX IF NOT EXISTS "Escrow_state_createdAt_idx"
ON "Escrow"("state", "createdAt");

CREATE INDEX IF NOT EXISTS "Dispute_escrowId_idx"
ON "Dispute"("escrowId");

CREATE INDEX IF NOT EXISTS "Notification_escrowId_idx"
ON "Notification"("escrowId");

