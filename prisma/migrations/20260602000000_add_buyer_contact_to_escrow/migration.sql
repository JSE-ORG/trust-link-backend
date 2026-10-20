-- Migration: add_buyer_contact_to_escrow
-- Issue #28 — store encrypted buyer email and phone on the Escrow record
-- so NotificationsService can reach the buyer without exposing a Stellar address.
--
-- Both columns are nullable: contact info is collected at payment time via
-- PATCH /escrow/:id/buyer-contact but is not required to fund an escrow.
-- Values are AES-256-GCM encrypted at the application layer before storage.

ALTER TABLE "Escrow"
  ADD COLUMN "buyerContactEmail" TEXT,
  ADD COLUMN "buyerContactPhone" TEXT;