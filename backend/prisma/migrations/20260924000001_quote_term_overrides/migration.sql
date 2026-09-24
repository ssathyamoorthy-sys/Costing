-- Supervisor-only per-quote overrides of the customer's margin/commission/WC/LC interest
-- terms. Null means "use the customer's master value" for that quote.
ALTER TABLE "Quote" ADD COLUMN "marginPctOverride" REAL;
ALTER TABLE "Quote" ADD COLUMN "commissionPctOverride" REAL;
ALTER TABLE "Quote" ADD COLUMN "wcInterestPctOverride" REAL;
ALTER TABLE "Quote" ADD COLUMN "lcInterestPctOverride" REAL;
