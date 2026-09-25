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

export interface ItemType {
  id: number;
  name: string;
  stitchingCostPerKg: number;
  packingCostPerKg: number;
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
}

export interface ProductAccessory {
  id?: number;
  accessoryTypeId: number;
  accessoryType?: AccessoryType;
  costPerPiece: number;
}

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

export type QuoteStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SENT' | 'WON' | 'LOST';

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
}

export interface QuoteLineSegmentYarn {
  id?: number;
  slot: string;
  rawMaterialId: number;
  rawMaterial?: RawMaterial;
  mixingPct: number;
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
  costBreakupJson?: string | null; // { ratePerSet: Record<currency, number> }
  segments: QuoteLineSegment[];
}

export interface Quote {
  id: number;
  quoteNo: string;
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
  version: number;
  createdAt: string;
  lines: QuoteLine[];
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
