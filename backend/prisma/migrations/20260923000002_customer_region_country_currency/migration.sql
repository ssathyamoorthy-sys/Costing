-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "region" TEXT NOT NULL DEFAULT 'Domestic (India)';
ALTER TABLE "Customer" ADD COLUMN "countries" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';
