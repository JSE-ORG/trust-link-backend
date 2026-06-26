-- Issue #77: Persist processed Stellar webhook operation IDs so the
-- deduplication cursor survives service restarts.
-- Horizon may retry event delivery; without a durable store a restarted
-- service would re-process already-handled operations.

CREATE TABLE "ProcessedWebhookEvent" (
    "operationId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("operationId")
);

-- Allow efficient pruning of old entries by timestamp
CREATE INDEX "ProcessedWebhookEvent_processedAt_idx" ON "ProcessedWebhookEvent"("processedAt");
