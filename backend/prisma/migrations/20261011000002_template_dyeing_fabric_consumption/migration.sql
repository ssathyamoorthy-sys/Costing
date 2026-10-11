-- Carries the new yarn-dyed/garment fields through to saved quote-line templates too,
-- so saving a yarn-dyed or garment line as a template (and reapplying it later) doesn't
-- silently lose the per-slot dyeing cost or the fabric-consumption sizing.
ALTER TABLE "QuoteTemplateSegmentYarn" ADD COLUMN "dyeingCostPerKg" REAL NOT NULL DEFAULT 0;
ALTER TABLE "QuoteTemplateSegmentItem" ADD COLUMN "fabricConsumptionSqm" REAL;
