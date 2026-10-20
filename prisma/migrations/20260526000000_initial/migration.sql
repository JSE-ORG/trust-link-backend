-- Baseline migration: Create foundational tables and enums
-- This must run before existing migrations which assume these objects exist.
-- All statements are idempotent (IF NOT EXISTS) so this is safe on any database.
--
-- Production note:
-- If your production database was originally set up via `prisma db push`
-- (no _prisma_migrations table), you must run the following BEFORE this
-- migration is applied, to mark the existing schema as migrated:
--
--   npx prisma db push
--   npx prisma migrate resolve --applied "20260526000000_initial"
--   npx prisma migrate resolve --applied "20260527060000_add_auto_release"
--   npx prisma migrate resolve --applied "20260527120000_add_vendor_account_details_and_tracking"
--   npx prisma migrate resolve --applied "20260527140000_add_escrow_event"
--   npx prisma migrate resolve --applied "20260528000000_add_webhook_cursor"
--   npx prisma migrate resolve --applied "20260529000000_security_updates"
--   npx prisma migrate resolve --applied "20260529120000_add_state_deliveredat_composite_index"
--   npx prisma migrate resolve --applied "20260529170000_query_performance_indexes"
--   npx prisma migrate resolve --applied "20260602000000_add_buyer_contact_to_escrow"
--   npx prisma migrate resolve --applied "20260623000000_add_cursor_and_failed_transaction_tables"
--   npx prisma migrate resolve --applied "20260626000000_add_notification_dispute_indexes"
--   npx prisma migrate resolve --applied "20260627000000_auto_release_composite_indexes"
--   npx prisma migrate resolve --applied "20260628000000_add_cancelled_abandoned_to_dispute_status"
--   npx prisma migrate resolve --applied "20260701000000_vendor_dashboard_vendor_state_index"
--
-- A convenience script is available at scripts/resolve-existing-migrations.sh

-- EscrowState enum (without RELEASED, CANCELLED -- added idempotently by migration #6)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EscrowState') THEN
    CREATE TYPE "EscrowState" AS ENUM ('CREATED', 'FUNDED', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'DISPUTED', 'REFUNDED');
  END IF;
END;
$$;

-- DisputeStatus enum (without CANCELLED, ABANDONED -- added by migration #12, not idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DisputeStatus') THEN
    CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED');
  END IF;
END;
$$;

-- NotificationStatus enum (never modified by any migration)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationStatus') THEN
    CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
  END IF;
END;
$$;

-- Escrow table
-- Columns added by later migrations are excluded here:
--   autoReleaseSubmittedAt  -> #1 (not idempotent)
--   deliveredAt, deliveryRecordedAt, autoReleaseTxHash, disputeId, cancelledAt -> #6 (idempotent)
--   buyerContactEmail, buyerContactPhone -> #8 (not idempotent)
CREATE TABLE IF NOT EXISTS "Escrow" (
    "id" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemRef" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "buyerAddress" TEXT NOT NULL,
    "vendorAddress" TEXT NOT NULL,
    "state" "EscrowState" NOT NULL DEFAULT 'CREATED',
    "trackingId" TEXT,
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id")
);

-- VendorProfile table (never modified by any migration)
CREATE TABLE IF NOT EXISTS "VendorProfile" (
    "address" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VendorProfile_pkey" PRIMARY KEY ("address")
);

-- Dispute table
-- Columns added by later migrations:
--   description, evidenceUrls, resolvedAt -> #6 (idempotent)
CREATE TABLE IF NOT EXISTS "Dispute" (
    "id" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- Notification table (never modified by any migration)
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Core indexes (not created by any existing migration)
CREATE INDEX IF NOT EXISTS "Escrow_vendorAddress_idx" ON "Escrow"("vendorAddress");
CREATE INDEX IF NOT EXISTS "Escrow_buyerAddress_idx" ON "Escrow"("buyerAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "Escrow_vendorAddress_itemRef_key" ON "Escrow"("vendorAddress", "itemRef");
CREATE UNIQUE INDEX IF NOT EXISTS "Dispute_escrowId_key" ON "Dispute"("escrowId");
CREATE INDEX IF NOT EXISTS "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- Core foreign keys (not created by any existing migration)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Escrow_vendorAddress_fkey') THEN
    ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_vendorAddress_fkey"
      FOREIGN KEY ("vendorAddress") REFERENCES "VendorProfile"("address")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Dispute_escrowId_fkey') THEN
    ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_escrowId_fkey"
      FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_escrowId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_escrowId_fkey"
      FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
