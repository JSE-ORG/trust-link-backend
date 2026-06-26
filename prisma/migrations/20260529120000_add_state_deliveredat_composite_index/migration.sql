-- Issue #101: Add composite index on (state, deliveredAt) to support the
-- auto-release background worker's eligibility query without a full table scan.
-- The worker polls every 5 minutes for SHIPPED escrows whose deliveredAt
-- threshold has elapsed; this index lets PostgreSQL satisfy the lookup with an
-- index range scan rather than a sequential scan.

-- Add columns that may be missing from older schema push deployments
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "deliveredAt"            TIMESTAMP(3);
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "deliveryRecordedAt"     TIMESTAMP(3);
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "autoReleaseTxHash"      TEXT;
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "disputeId"              TEXT;
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "cancelledAt"            TIMESTAMP(3);

-- Add RELEASED and CANCELLED enum values (safe to run even if already present)
DO $$ BEGIN
  ALTER TYPE "EscrowState" ADD VALUE IF NOT EXISTS 'RELEASED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "EscrowState" ADD VALUE IF NOT EXISTS 'CANCELLED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Composite index that makes the auto-release eligibility query index-only
-- for the (state, deliveredAt) predicate before filtering autoReleaseTxHash.
CREATE INDEX IF NOT EXISTS "Escrow_state_deliveredAt_idx" ON "Escrow"("state", "deliveredAt");

-- Consolidate Dispute table: add missing columns from the merged model
ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "description"  TEXT NOT NULL DEFAULT '';
ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "evidenceUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "resolvedAt"   TIMESTAMP(3);

-- Change status column from enum to text if it is still the old enum type
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t  ON t.oid = a.atttypid
    WHERE c.relname = 'Dispute' AND a.attname = 'status' AND t.typtype = 'e'
  ) THEN
    ALTER TABLE "Dispute" ALTER COLUMN "status" TYPE TEXT USING status::TEXT;
    ALTER TABLE "Dispute" ALTER COLUMN "status" SET DEFAULT 'OPEN';
  END IF;
END $$;

-- Ensure escrowId index exists for fast dispute lookups by escrow
CREATE INDEX IF NOT EXISTS "Dispute_escrowId_idx" ON "Dispute"("escrowId");
