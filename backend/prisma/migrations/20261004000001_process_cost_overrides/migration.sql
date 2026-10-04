-- Per-quote overrides for process-cost fields that previously came only from shared
-- master data (Product, Item Type, Processing Charge, General Mapping freight setting).
-- Mirrors the existing yarn-price/margin/commission override pattern: null means "use the
-- master value", a non-null value here wins for this quote only and never touches the
-- shared master record.
ALTER TABLE "Quote" ADD COLUMN "freightExportPerKgOverride" REAL;

ALTER TABLE "QuoteLine" ADD COLUMN "processingChargeRatePerKgOverride" REAL;

ALTER TABLE "QuoteLineSegment" ADD COLUMN "weavingSizingCostPerKgOverride" REAL;
ALTER TABLE "QuoteLineSegment" ADD COLUMN "firstVelourChargesOverride" REAL;
ALTER TABLE "QuoteLineSegment" ADD COLUMN "secondVelourChargesOverride" REAL;
ALTER TABLE "QuoteLineSegment" ADD COLUMN "transportLocalPerKgOverride" REAL;

ALTER TABLE "QuoteLineSegmentItem" ADD COLUMN "stitchingCostPerKgOverride" REAL;
ALTER TABLE "QuoteLineSegmentItem" ADD COLUMN "packingCostPerKgOverride" REAL;
