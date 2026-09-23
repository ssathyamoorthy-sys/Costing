-- DropTable (no real customer data exists yet - clean break rather than a data migration)
DROP TABLE "QuoteLineAccessory";
DROP TABLE "QuoteLineMaterialOverride";
DROP TABLE "QuoteLine";

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quoteId" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "qtySets" INTEGER NOT NULL,
    "targetPrice" REAL,
    "costBreakupJson" TEXT,
    CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteLineSegment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quoteLineId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "QuoteLineSegment_quoteLineId_fkey" FOREIGN KEY ("quoteLineId") REFERENCES "QuoteLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteLineSegment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteLineSegmentYarn" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "segmentId" INTEGER NOT NULL,
    "slot" TEXT NOT NULL,
    "rawMaterialId" INTEGER NOT NULL,
    "mixingPct" REAL NOT NULL,
    CONSTRAINT "QuoteLineSegmentYarn_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "QuoteLineSegment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteLineSegmentYarn_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteLineSegmentItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "segmentId" INTEGER NOT NULL,
    "itemTypeId" INTEGER NOT NULL,
    "lengthCm" REAL NOT NULL,
    "widthCm" REAL NOT NULL,
    "gsm" REAL NOT NULL,
    "qtyPerSet" INTEGER NOT NULL,
    "pieceWeightGrams" REAL,
    "qtyKg" REAL,
    "costBreakupJson" TEXT,
    CONSTRAINT "QuoteLineSegmentItem_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "QuoteLineSegment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteLineSegmentItem_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "ItemType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteLineSegmentItemAccessory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "accessoryTypeId" INTEGER NOT NULL,
    "costPerPiece" REAL NOT NULL,
    CONSTRAINT "QuoteLineSegmentItemAccessory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "QuoteLineSegmentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteLineSegmentItemAccessory_accessoryTypeId_fkey" FOREIGN KEY ("accessoryTypeId") REFERENCES "AccessoryType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLineSegmentItemAccessory_itemId_accessoryTypeId_key" ON "QuoteLineSegmentItemAccessory"("itemId", "accessoryTypeId");

-- CreateTable
CREATE TABLE "QuoteLineSegmentItemPackaging" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "ratePerPiece" REAL NOT NULL,
    CONSTRAINT "QuoteLineSegmentItemPackaging_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "QuoteLineSegmentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteLineSegmentMaterialOverride" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "segmentId" INTEGER NOT NULL,
    "rawMaterialId" INTEGER NOT NULL,
    "overridePricePerKg" REAL NOT NULL,
    "reason" TEXT,
    "setById" INTEGER NOT NULL,
    "notifiedPurchaseAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteLineSegmentMaterialOverride_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "QuoteLineSegment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteLineSegmentMaterialOverride_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuoteLineSegmentMaterialOverride_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
