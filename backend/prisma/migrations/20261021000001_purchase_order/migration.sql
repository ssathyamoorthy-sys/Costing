-- The customer's Purchase Order, attachable once "Converted to Order" - required before
-- "Lock & Finalize" can generate the CVN (enforced in routes/quotes.ts, not here). Stored
-- inline in the SQLite file itself so it rides along with the existing backup scripts.
ALTER TABLE "Quote" ADD COLUMN "purchaseOrderFileName" TEXT;
ALTER TABLE "Quote" ADD COLUMN "purchaseOrderMimeType" TEXT;
ALTER TABLE "Quote" ADD COLUMN "purchaseOrderData" BLOB;
ALTER TABLE "Quote" ADD COLUMN "purchaseOrderUploadedAt" DATETIME;
ALTER TABLE "Quote" ADD COLUMN "purchaseOrderUploadedById" INTEGER REFERENCES "User"("id");
