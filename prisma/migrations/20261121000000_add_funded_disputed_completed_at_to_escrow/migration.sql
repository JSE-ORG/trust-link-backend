-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN "fundedAt" TIMESTAMP(3);
ALTER TABLE "Escrow" ADD COLUMN "disputedAt" TIMESTAMP(3);
ALTER TABLE "Escrow" ADD COLUMN "completedAt" TIMESTAMP(3);
