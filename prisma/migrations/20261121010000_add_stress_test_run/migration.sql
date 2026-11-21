CREATE TABLE "StressTestRun" (
    "testId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StressTestRun_pkey" PRIMARY KEY ("testId")
);

CREATE INDEX "StressTestRun_createdAt_idx" ON "StressTestRun"("createdAt");
CREATE INDEX "StressTestRun_status_idx" ON "StressTestRun"("status");
