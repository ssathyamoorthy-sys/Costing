-- HSN/Duty Drawback master, Supervisor/Admin-controlled.
CREATE TABLE "HsnCode" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "description" TEXT NOT NULL,
  "hsCode" TEXT NOT NULL,
  "uom" TEXT NOT NULL,
  "dbkPct" REAL NOT NULL,
  "rosctlRodepPct" REAL NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HsnCode_hsCode_key" ON "HsnCode"("hsCode");

-- Per-quote-line-item HSN selection.
ALTER TABLE "QuoteLineSegmentItem" ADD COLUMN "hsnCodeId" INTEGER REFERENCES "HsnCode"("id");

-- Per-Set (per quote-line) margin override, for "Match target price" - wins over the
-- quote-wide override for this Set only.
ALTER TABLE "QuoteLine" ADD COLUMN "marginPctOverride" REAL;

-- Whole-quote named templates: group multiple existing per-line QuoteTemplates together.
CREATE TABLE "QuoteTemplateGroup" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "customerId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "createdById" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteTemplateGroup_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QuoteTemplateGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QuoteTemplateGroup_customerId_name_key" ON "QuoteTemplateGroup"("customerId", "name");

CREATE TABLE "QuoteTemplateGroupMember" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "groupId" INTEGER NOT NULL,
  "templateId" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "QuoteTemplateGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "QuoteTemplateGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QuoteTemplateGroupMember_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuoteTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
