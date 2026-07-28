#!/usr/bin/env bash
# ------------------------------------------------------------------
# One-time script to transition a production database from `prisma db push`
# to `prisma migrate` management.
#
# Run this BEFORE the baseline migration (20260526000000_initial) is deployed
# to a database that was originally created via `prisma db push`.
#
# Usage:
#   DATABASE_URL=postgresql://... bash scripts/resolve-existing-migrations.sh
#
# This marks all existing migration files as already applied, so future
# `prisma migrate deploy` runs only apply new migrations.
# ------------------------------------------------------------------
set -euo pipefail

echo "=== Syncing schema via db push ==="
npx prisma db push --accept-data-loss

echo "=== Marking all 14 migrations as applied ==="
npx prisma migrate resolve --applied "20260526000000_initial"
npx prisma migrate resolve --applied "20260527060000_add_auto_release"
npx prisma migrate resolve --applied "20260527120000_add_vendor_account_details_and_tracking"
npx prisma migrate resolve --applied "20260527140000_add_escrow_event"
npx prisma migrate resolve --applied "20260528000000_add_webhook_cursor"
npx prisma migrate resolve --applied "20260529000000_security_updates"
npx prisma migrate resolve --applied "20260529120000_add_state_deliveredat_composite_index"
npx prisma migrate resolve --applied "20260529170000_query_performance_indexes"
npx prisma migrate resolve --applied "20260602000000_add_buyer_contact_to_escrow"
npx prisma migrate resolve --applied "20260623000000_add_cursor_and_failed_transaction_tables"
npx prisma migrate resolve --applied "20260626000000_add_notification_dispute_indexes"
npx prisma migrate resolve --applied "20260627000000_auto_release_composite_indexes"
npx prisma migrate resolve --applied "20260628000000_add_cancelled_abandoned_to_dispute_status"
npx prisma migrate resolve --applied "20260701000000_vendor_dashboard_vendor_state_index"

echo "=== Done! Database is now migration-managed. ==="
echo "Future deploys via 'prisma migrate deploy' will only apply new migrations."
