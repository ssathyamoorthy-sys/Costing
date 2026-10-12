-- Generic change log for the masters (Product, Customer, ProcessingCharge, HsnCode,
-- ExchangeRate, GeneralSetting) - who changed what field, from what to what, and when.
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "entityLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changesJson" TEXT NOT NULL,
    "changedById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_entityType_createdAt_idx" ON "AuditLog"("entityType", "createdAt");
