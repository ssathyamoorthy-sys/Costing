-- CreateTable
CREATE TABLE "QuoteTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "qtySets" INTEGER NOT NULL DEFAULT 1,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteTemplate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteTemplate_customerId_name_key" ON "QuoteTemplate"("customerId", "name");

-- CreateTable
CREATE TABLE "QuoteTemplateSegment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "templateId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "QuoteTemplateSegment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuoteTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteTemplateSegment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteTemplateSegmentYarn" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "segmentId" INTEGER NOT NULL,
    "slot" TEXT NOT NULL,
    "rawMaterialId" INTEGER NOT NULL,
    "mixingPct" REAL NOT NULL,
    CONSTRAINT "QuoteTemplateSegmentYarn_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "QuoteTemplateSegment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteTemplateSegmentYarn_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteTemplateSegmentItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "segmentId" INTEGER NOT NULL,
    "itemTypeId" INTEGER NOT NULL,
    "lengthCm" REAL NOT NULL,
    "widthCm" REAL NOT NULL,
    "gsm" REAL NOT NULL,
    "qtyPerSet" INTEGER NOT NULL,
    CONSTRAINT "QuoteTemplateSegmentItem_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "QuoteTemplateSegment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteTemplateSegmentItem_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "ItemType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteTemplateSegmentItemAccessory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "accessoryTypeId" INTEGER NOT NULL,
    "costPerPiece" REAL NOT NULL,
    CONSTRAINT "QuoteTemplateSegmentItemAccessory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "QuoteTemplateSegmentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteTemplateSegmentItemAccessory_accessoryTypeId_fkey" FOREIGN KEY ("accessoryTypeId") REFERENCES "AccessoryType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteTemplateSegmentItemAccessory_itemId_accessoryTypeId_key" ON "QuoteTemplateSegmentItemAccessory"("itemId", "accessoryTypeId");

-- CreateTable
CREATE TABLE "QuoteTemplateSegmentItemPackaging" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "ratePerPiece" REAL NOT NULL,
    CONSTRAINT "QuoteTemplateSegmentItemPackaging_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "QuoteTemplateSegmentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
