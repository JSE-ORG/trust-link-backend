-- Migration: add_provider_credential_table
-- Issues #498, #499 — Persistent storage for rotated provider credentials
-- (e.g. the logistics API key), so a key rotation survives process restarts
-- and propagates across replicas instead of living only in memory.

CREATE TABLE "ProviderCredential" (
  "provider"     TEXT NOT NULL,
  "encryptedKey" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("provider")
);
