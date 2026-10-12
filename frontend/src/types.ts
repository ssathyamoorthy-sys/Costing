export type Role = 'PURCHASE' | 'SUPERVISOR' | 'MERCHANDISER' | 'ADMIN';

export interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
  email?: string | null;
}

export interface RawMaterial {
  id: number;
  code: string;
  description?: string | null;
  currentRate: { pricePerKg: number; rateId: number; isStale: boolean; validFrom: string; validTo: string | null } | null;
}

export interface RawMaterialRate {
  id: number;
  rawMaterialId: number;
  pricePerKg: number;
  validFrom: string;
  validTo: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  enteredBy?: { name: string };
  approvedBy?: { name: string } | null;
  rejectReason?: string | null;
  createdAt: string;
}

export type SizingMethod = 'DIMENSIONS' | 'FABRIC_CONSUMPTION';

export interface ItemType {
  id: number;
  name: string;
  stitchingCostPerKg: number;
  packingCostPerKg: number;
  // How items of this type are sized: DIMENSIONS (default, towels) or FABRIC_CONSUMPTION
  // (garments, e.g. bathrobes) - see schema.prisma.
  sizingMethod: SizingMethod;
  // Alternative to stitchingCostPerKg for garments - a flat per-piece labor cost.
  stitchingCostPerPiece: number;
}

export interface ProcessingCharge {
  id: number;
  color: string;
  ratePerKg: number;
}

export interface AccessoryType {
  id: number;
  name: string;
}

export interface HsnCode {
  id: number;
  description: string;
  hsCode: string;
  uom: string;
  dbkPct: number;
  rosctlRodepPct: number;
  active: boolean;
}

export interface ProductYarnComponent {
  id?: number;
  slot: string;
  rawMaterialId: number;
  rawMaterial?: RawMaterial;
  mixingPct: number;
  // Yarn-dyed only: cost/kg to dye this slot.
  dyeingCostPerKg?: number;
}

export interface ProductAccessory {
  id?: number;
  accessoryTypeId: number;
  accessoryType?: AccessoryType;
  costPerPiece: number;
}

export type ColorMethod = 'PIECE_DYED' | 'YARN_DYED';

export interface Product {
  id: number;
  code: string;
  name?: string | null;
  weavingWastagePct: number;
  weavingSizingCostPerKg: number;
  firstVelourCharges: number;
  firstVelourLossPct: number;
  secondVelourCharges: number;
  secondVelourLossPct: number;
  weightLossPct: number;
  transportLocalPerKg: number;
  rejectionPct: number;
  // Optional second, sequential rejection stage (garment items, e.g. bathrobes).
  secondRejectionPct: number;
  // Color method: PIECE_DYED (default, flat Processing Charge after weaving) or
  // YARN_DYED (yarn dyed per-slot before weaving, washed after weaving instead).
  colorMethod: ColorMethod;
  yarnDyeingProcessLossPct: number;
  washingCostPerKg: number;
  washingLossPct: number;
  active: boolean;
  yarnComponents: ProductYarnComponent[];
  accessories: ProductAccessory[];
}

export type Region = 'Asia' | 'Europe' | 'UK' | 'US' | 'Oceania' | 'Far East' | 'Domestic (India)';
export type Currency = 'INR' | 'USD' | 'GBP' | 'EUR';

export interface Customer {
  id: number;
  name: string;
  region: Region;
  countries: string; // comma-separated
  currency: Currency;
  paymentTerms?: string | null;
  freightTerms?: string | null;
  wcInterestPct: number;
  lcInterestPct: number;
  marginPct: number;
  commissionPct: number;
  active: boolean;
}

export interface ExchangeRate {
  id: number;
  currency: string;
  ratePerInr: number;
  validFrom: string;
  createdAt: string;
}

export type QuoteStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT'
  | 'CONVERTED_TO_ORDER'
  | 'LOST_PRICE'
  | 'LOST_MOQ'
  | 'LOST_LEAD_TIME';

export interface CostingBreakup {
  bomMultiplier: number;
  yarnCostPerKg: number;
  weavingSizingCostPerKg: number;
  firstVelourChargesPerKg: number;
  subtotalAfterWeaving: number;
  processingChargesPerKg: number;
  subtotalAfterProcessing: number;
  secondVelourChargesPerKg: number;
  subtotalAfterSecondVelour: number;
  transportLocalPerKg: number;
  accessoriesPerKg: number;
  stitchingPackingPerKg: number;
  subtotalAfterStitching: number;
  wcInterestPerKg: number;
  freightExportPerKg: number;
  subtotalAfterFreight: number;
  lcInterestPerKg: number;
  subtotalBeforeMargin: number;
  marginPerKg: number;
  subtotalAfterMargin: number;
  commissionPerKg: number;
  finalPricePerKgInr: number;
  pieceWeightGrams: number;
  qtyKg: number;
  ratePerKg: Record<string, number>;
  ratePerPiece: Record<string, number>;

  hsnCode?: string | null;
  totalIncentivePct?: number;
  profitPerKgInr?: number;
  dbkProfitPerKgInr?: number;
  profitInclDbkPerKgInr?: number;
  profitInclDbk?: Record<string, number>;
  marginPct?: number;
  effectiveMarginPctInclDbk?: number;
}

export interface QuoteLineSegmentYarn {
  id?: number;
  slot: string;
  rawMaterialId: number;
  rawMaterial?: RawMaterial;
  mixingPct: number;
  dyeingCostPerKg?: number;
}

export interface QuoteLineSegmentItemAccessory {
  id?: number;
  accessoryTypeId: number;
  accessoryType?: AccessoryType;
  costPerPiece: number;
}

export interface QuoteLineSegmentItemPackaging {
  id?: number;
  description: string;
  ratePerPiece: number;
}

export interface QuoteLineSegmentItem {
  id?: number;
  itemTypeId: number;
  itemType?: ItemType;
  lengthCm: number;
  widthCm: number;
  // Garment items only (Item Type sizingMethod = FABRIC_CONSUMPTION, e.g. bathrobes) -
  // fabric required per piece in sq.m, used instead of lengthCm x widthCm.
  fabricConsumptionSqm?: number | null;
  gsm: number;
  qtyPerSet: number;
  hsnCodeId?: number | null;
  hsnCode?: HsnCode | null;
  pieceWeightGrams?: number | null;
  qtyKg?: number | null;
  costBreakupJson?: string | null;
  accessoryOverrides: QuoteLineSegmentItemAccessory[];
  packagingCharges: QuoteLineSegmentItemPackaging[];
}

export interface QuoteLineSegment {
  id?: number;
  productId: number;
  product?: Product;
  sortOrder?: number;
  yarnComponents: QuoteLineSegmentYarn[];
  items: QuoteLineSegmentItem[];
  materialOverrides?: { id: number; rawMaterialId: number; rawMaterial: RawMaterial; overridePricePerKg: number; reason?: string | null }[];
}

export interface QuoteLine {
  id: number;
  quoteId: number;
  color: string;
  qtySets: number;
  targetPrice?: number | null;
  marginPctOverride?: number | null;
  costBreakupJson?: string | null; // { ratePerSet: Record<currency, number> }
  segments: QuoteLineSegment[];
}

export interface Quote {
  id: number;
  quoteNo: string;
  customerEnquiryNo?: string | null;
  customerId: number;
  customer: Customer;
  status: QuoteStatus;
  createdById: number;
  createdBy?: { name: string };
  approvedBy?: { name: string } | null;
  remarks?: string | null;
  validityDate?: string | null;
  paymentTerms?: string | null;
  freightTerms?: string | null;
  currency: Currency;
  marginPctOverride?: number | null;
  commissionPctOverride?: number | null;
  wcInterestPctOverride?: number | null;
  lcInterestPctOverride?: number | null;
  locked: boolean;
  lockedAt?: string | null;
  lockedBy?: { name: string } | null;
  finalReferenceNo?: string | null;
  version: number;
  createdAt: string;
  lines: QuoteLine[];
}

export interface QuoteRevisionSnapshotLine {
  lineId: number;
  color: string;
  qtySets: number;
  targetPrice: number | null;
  marginPctOverride: number | null;
  ratePerSet: Record<string, number> | null;
}
export interface QuoteRevisionSnapshot {
  quote: {
    marginPctOverride: number | null;
    commissionPctOverride: number | null;
    wcInterestPctOverride: number | null;
    lcInterestPctOverride: number | null;
    currency: string;
  };
  lines: QuoteRevisionSnapshotLine[];
}
export interface QuoteRevision {
  id: number;
  quoteId: number;
  revisionNo: number;
  snapshot: QuoteRevisionSnapshot;
  createdBy?: { name: string };
  createdAt: string;
}

export interface QuoteTemplateSummary {
  id: number;
  name: string;
  color: string;
  qtySets: number;
  createdAt: string;
  createdBy?: { name: string };
}

export interface QuoteTemplate extends QuoteTemplateSummary {
  segments: QuoteLineSegment[];
}

export interface QuoteTemplateGroupSummary {
  id: number;
  name: string;
  createdAt: string;
  createdBy?: { name: string };
  setCount: number;
}

export interface QuoteTemplateGroup {
  id: number;
  name: string;
  templates: QuoteTemplate[];
}

export interface Notification {
  id: number;
  type: string;
  message: string;
  read: boolean;
  emailSent: boolean;
  createdAt: string;
}
