ALTER TABLE "Escrow" ADD COLUMN "trackingCheckedAt" TIMESTAMP(3);

CREATE INDEX "Escrow_state_trackingCheckedAt_idx" ON "Escrow"("state", "trackingCheckedAt");
