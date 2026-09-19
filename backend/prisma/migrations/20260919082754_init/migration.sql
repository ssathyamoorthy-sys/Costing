-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RawMaterial" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "RawMaterialRate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rawMaterialId" INTEGER NOT NULL,
    "pricePerKg" REAL NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "enteredById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "approvedAt" DATETIME,
    "rejectReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RawMaterialRate_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RawMaterialRate_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RawMaterialRate_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ItemType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "stitchingCostPerKg" REAL NOT NULL,
    "packingCostPerKg" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "itemTypeId" INTEGER NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "ItemType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductYarnComponent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "slot" TEXT NOT NULL,
    "rawMaterialId" INTEGER NOT NULL,
    "mixingPct" REAL NOT NULL,
    CONSTRAINT "ProductYarnComponent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductYarnComponent_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessingCharge" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "color" TEXT NOT NULL,
    "ratePerKg" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "AccessoryType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ProductAccessory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "accessoryTypeId" INTEGER NOT NULL,
    "costPerPiece" REAL NOT NULL,
    CONSTRAINT "ProductAccessory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductAccessory_accessoryTypeId_fkey" FOREIGN KEY ("accessoryTypeId") REFERENCES "AccessoryType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "paymentTerms" TEXT,
    "freightTerms" TEXT,
    "wcInterestPct" REAL NOT NULL,
    "lcInterestPct" REAL NOT NULL,
    "marginPct" REAL NOT NULL,
    "commissionPct" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "currency" TEXT NOT NULL,
    "ratePerInr" REAL NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "enteredById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeRate_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quoteNo" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "approvedAt" DATETIME,
    "remarks" TEXT,
    "validityDate" DATETIME,
    "paymentTerms" TEXT,
    "freightTerms" TEXT,
    "currencies" TEXT NOT NULL DEFAULT 'INR,USD,GBP',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quote_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quoteId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "itemTypeId" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "lengthCm" REAL NOT NULL,
    "widthCm" REAL NOT NULL,
    "gsm" REAL NOT NULL,
    "qtyPcs" INTEGER NOT NULL,
    "targetPrice" REAL,
    "pieceWeightGrams" REAL,
    "qtyKg" REAL,
    "costBreakupJson" TEXT,
    "ratePerKgInr" REAL,
    "ratePerPieceInr" REAL,
    "ratePerKgUsd" REAL,
    "ratePerPieceUsd" REAL,
    "ratePerKgGbp" REAL,
    "ratePerPieceGbp" REAL,
    "ratePerKgEur" REAL,
    "ratePerPieceEur" REAL,
    CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuoteLine_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "ItemType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteLineAccessory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quoteLineId" INTEGER NOT NULL,
    "accessoryTypeId" INTEGER NOT NULL,
    "costPerPiece" REAL NOT NULL,
    CONSTRAINT "QuoteLineAccessory_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "QuoteLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteLineAccessory_accessoryTypeId_fkey" FOREIGN KEY ("accessoryTypeId") REFERENCES "AccessoryType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteLineMaterialOverride" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quoteLineId" INTEGER NOT NULL,
    "rawMaterialId" INTEGER NOT NULL,
    "overridePricePerKg" REAL NOT NULL,
    "reason" TEXT,
    "setById" INTEGER NOT NULL,
    "notifiedPurchaseAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteLineMaterialOverride_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "QuoteLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteLineMaterialOverride_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuoteLineMaterialOverride_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneralSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterial_code_key" ON "RawMaterial"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ItemType_name_key" ON "ItemType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingCharge_color_key" ON "ProcessingCharge"("color");

-- CreateIndex
CREATE UNIQUE INDEX "AccessoryType_name_key" ON "AccessoryType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAccessory_productId_accessoryTypeId_key" ON "ProductAccessory"("productId", "accessoryTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "ExchangeRate_currency_validFrom_idx" ON "ExchangeRate"("currency", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_quoteNo_key" ON "Quote"("quoteNo");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLineAccessory_quoteLineId_accessoryTypeId_key" ON "QuoteLineAccessory"("quoteLineId", "accessoryTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneralSetting_key_key" ON "GeneralSetting"("key");
