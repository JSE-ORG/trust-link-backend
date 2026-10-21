-- The Soroban contract mints its own escrow identifier: a u64 from an on-chain
-- counter. The backend mints "id" as a UUID before any chain call, so the two
-- are unrelated. This column is the join between them.
--
-- Nullable because an escrow row exists before its on-chain counterpart does.
-- Unique because one contract escrow maps to exactly one backend escrow, and a
-- duplicate would let two rows claim the same on-chain funds.
ALTER TABLE "Escrow" ADD COLUMN "contractEscrowId" BIGINT;

CREATE UNIQUE INDEX "Escrow_contractEscrowId_key" ON "Escrow"("contractEscrowId");
