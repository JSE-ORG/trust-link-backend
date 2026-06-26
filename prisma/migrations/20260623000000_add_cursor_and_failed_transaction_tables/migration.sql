-- Migration: add_cursor_and_failed_transaction_tables
-- Issues #306, #303 — Database-backed cursor persistence and persistent DLQ storage

-- Issue #306: Cursor table for blockchain listener
CREATE TABLE "Cursor" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "cursorValue" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Cursor_pkey" PRIMARY KEY ("id")
);

-- Issue #303: FailedTransaction table for persistent DLQ
CREATE TABLE "FailedTransaction" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "operation" TEXT NOT NULL,
  "escrowId" TEXT,
  "errorMessage" TEXT NOT NULL,
  "ledgerFeedback" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "lastReplayTxHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "replayedAt" TIMESTAMP(3),

  CONSTRAINT "FailedTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FailedTransaction_status_idx" ON "FailedTransaction"("status");
CREATE INDEX "FailedTransaction_escrowId_idx" ON "FailedTransaction"("escrowId");
CREATE INDEX "FailedTransaction_createdAt_idx" ON "FailedTransaction"("createdAt");
