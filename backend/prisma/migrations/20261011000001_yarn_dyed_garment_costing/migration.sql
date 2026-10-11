-- Yarn-dyed costing (dye the yarn before weaving, wash after) and garment costing
-- (sized by fabric consumption in sq.m instead of length x width, e.g. bathrobes),
-- as two independent, additive options alongside the existing piece-dyed/flat-item
-- costing, which is completely unchanged when these new fields are left at their
-- defaults.

ALTER TABLE "Product" ADD COLUMN "secondRejectionPct" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "colorMethod" TEXT NOT NULL DEFAULT 'PIECE_DYED';
ALTER TABLE "Product" ADD COLUMN "yarnDyeingProcessLossPct" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "washingCostPerKg" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "washingLossPct" REAL NOT NULL DEFAULT 0;

ALTER TABLE "ProductYarnComponent" ADD COLUMN "dyeingCostPerKg" REAL NOT NULL DEFAULT 0;

ALTER TABLE "QuoteLineSegmentYarn" ADD COLUMN "dyeingCostPerKg" REAL NOT NULL DEFAULT 0;

ALTER TABLE "QuoteLineSegment" ADD COLUMN "washingCostPerKgOverride" REAL;

ALTER TABLE "ItemType" ADD COLUMN "sizingMethod" TEXT NOT NULL DEFAULT 'DIMENSIONS';
ALTER TABLE "ItemType" ADD COLUMN "stitchingCostPerPiece" REAL NOT NULL DEFAULT 0;

ALTER TABLE "QuoteLineSegmentItem" ADD COLUMN "fabricConsumptionSqm" REAL;
ALTER TABLE "QuoteLineSegmentItem" ADD COLUMN "stitchingCostPerPieceOverride" REAL;
