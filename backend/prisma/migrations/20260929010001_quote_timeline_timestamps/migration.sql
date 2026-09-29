-- Timeline timestamps for reporting (approval turnaround, sent lag).
ALTER TABLE "Quote" ADD COLUMN "submittedAt" DATETIME;
ALTER TABLE "Quote" ADD COLUMN "sentAt" DATETIME;
