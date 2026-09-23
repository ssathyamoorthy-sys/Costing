-- RenameColumn (Quote now carries a single currency, derived from the customer, not a
-- merchandiser-picked list)
ALTER TABLE "Quote" RENAME COLUMN "currencies" TO "currency";
