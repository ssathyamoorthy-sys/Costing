-- Lets a single yarn slot (e.g. "Pile") be split across multiple rows with different dyeing
-- costs (e.g. VAT-dyed vs white/undyed), each labeled with which dye batch/shade it is. Purely
-- cosmetic - pricing already sums every row's own mixingPct-weighted dyeingCostPerKg regardless
-- of this label (see backend/src/costing/engine.ts).
ALTER TABLE "ProductYarnComponent" ADD COLUMN "dyeVariant" TEXT;
ALTER TABLE "QuoteLineSegmentYarn" ADD COLUMN "dyeVariant" TEXT;
ALTER TABLE "QuoteTemplateSegmentYarn" ADD COLUMN "dyeVariant" TEXT;
