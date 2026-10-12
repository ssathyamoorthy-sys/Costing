-- The customer's own reference number for this enquiry (RFQ/PO number etc.) - free text,
-- purely informational, never used in pricing.
ALTER TABLE "Quote" ADD COLUMN "customerEnquiryNo" TEXT;
