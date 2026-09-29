-- Lock & Finalize: irrevocable reference number generated only at final lock, separate
-- from quoteNo which keeps working through every negotiation round.
ALTER TABLE "Quote" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quote" ADD COLUMN "lockedAt" DATETIME;
ALTER TABLE "Quote" ADD COLUMN "lockedById" INTEGER REFERENCES "User"("id");
ALTER TABLE "Quote" ADD COLUMN "finalReferenceNo" TEXT;
CREATE UNIQUE INDEX "Quote_finalReferenceNo_key" ON "Quote"("finalReferenceNo");

-- Revision history: automatic pricing snapshots taken before any price-mutating action
-- once a quote has already been shown to the customer (APPROVED/SENT).
CREATE TABLE "QuoteRevision" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "quoteId" INTEGER NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "note" TEXT,
  "createdById" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteRevision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QuoteRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "QuoteRevision_quoteId_revisionNo_idx" ON "QuoteRevision"("quoteId", "revisionNo");

-- Enquiry status model: "Won" becomes "Converted to Order" (same slot in the workflow);
-- the single "Lost" becomes three specific reasons. Existing LOST rows have no recorded
-- reason, so they map to LOST_PRICE as the most common case - Supervisor/Merchandiser can
-- correct any that were actually MOQ/lead-time losses.
UPDATE "Quote" SET "status" = 'CONVERTED_TO_ORDER' WHERE "status" = 'WON';
UPDATE "Quote" SET "status" = 'LOST_PRICE' WHERE "status" = 'LOST';
