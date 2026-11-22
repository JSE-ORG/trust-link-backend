-- AlterTable
-- Existing rows have no carrier; the application treats null as the default
-- carrier (GIGL), so the column is nullable.
ALTER TABLE "Escrow" ADD COLUMN "carrier" TEXT;
