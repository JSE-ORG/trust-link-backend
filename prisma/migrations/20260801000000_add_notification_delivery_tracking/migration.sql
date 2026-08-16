-- Add delivery-tracking columns used by NotificationsService (provider message
-- id, per-notification attempt counter, and last provider response code).
-- These were previously only tracked by the in-memory PrismaService fake.
ALTER TABLE "Notification" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN "lastResponseCode" INTEGER;
