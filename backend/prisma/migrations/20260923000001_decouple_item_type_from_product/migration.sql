-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "weavingWastagePct" REAL NOT NULL,
    "weavingSizingCostPerKg" REAL NOT NULL,
    "firstVelourCharges" REAL NOT NULL,
    "firstVelourLossPct" REAL NOT NULL,
    "secondVelourCharges" REAL NOT NULL,
    "secondVelourLossPct" REAL NOT NULL,
    "weightLossPct" REAL NOT NULL,
    "transportLocalPerKg" REAL NOT NULL,
    "rejectionPct" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("id", "code", "name", "weavingWastagePct", "weavingSizingCostPerKg", "firstVelourCharges", "firstVelourLossPct", "secondVelourCharges", "secondVelourLossPct", "weightLossPct", "transportLocalPerKg", "rejectionPct", "active", "createdAt", "updatedAt")
SELECT "id", "code", "name", "weavingWastagePct", "weavingSizingCostPerKg", "firstVelourCharges", "firstVelourLossPct", "secondVelourCharges", "secondVelourLossPct", "weightLossPct", "transportLocalPerKg", "rejectionPct", "active", "createdAt", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");
PRAGMA foreign_keys=ON;
