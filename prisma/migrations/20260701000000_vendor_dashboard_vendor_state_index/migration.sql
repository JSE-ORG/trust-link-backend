-- Issue #309: ensure the vendor dashboard query can use the composite
-- (vendorAddress, state) lookup path. This is idempotent because older
-- environments may already have the index from 20260529000000_security_updates.
CREATE INDEX IF NOT EXISTS "Escrow_vendorAddress_state_idx"
ON "Escrow"("vendorAddress", "state");
