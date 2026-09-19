/**
 * Terry towel costing engine.
 *
 * This is a direct port of the calculation chain in "Price Working .xlsx"
 * (sheets "70X140" / "50X100"), row references are noted in comments so the
 * logic can be checked against the original workbook. Every function is pure
 * (no DB/IO) so it can be unit tested against known-good figures.
 */

export interface YarnComponentInput {
  slot: string; // Ground / Pile / Weft / Scoured / custom
  mixingPct: number; // 0-100, must sum to 100 across all components
  pricePerKg: number; // resolved raw material price (master rate or override)
}

export interface AccessoryInput {
  name: string;
  costPerPiece: number;
}

export interface CostingInput {
  // Product-based mapping
  weavingWastagePct: number; // fraction, e.g. 0.025
  weavingSizingCostPerKg: number;
  firstVelourCharges: number;
  firstVelourLossPct: number;
  secondVelourCharges: number;
  secondVelourLossPct: number;
  weightLossPct: number;
  transportLocalPerKg: number;
  rejectionPct: number;

  yarnComponents: YarnComponentInput[];

  // Color-driven
  processingChargeRatePerKg: number;

  // Item-type driven (Bath Towel / Hand Towel / Bath Sheet / Face Towel / Bathrobe)
  stitchingCostPerKg: number;
  packingCostPerKg: number;

  // Accessories, per piece (product defaults merged with quote-line overrides upstream)
  accessories: AccessoryInput[];

  // General mapping
  freightExportPerKg: number;

  // Customer-based mapping
  wcInterestPct: number;
  lcInterestPct: number;
  marginPct: number; // stored as signed fraction, e.g. -0.03
  commissionPct: number; // e.g. 0.03

  // Size
  lengthCm: number;
  widthCm: number;
  gsm: number;
  qtyPcs: number;

  // currency -> INR value of 1 unit of that currency. INR itself should be 1.
  exchangeRates: Record<string, number>;
}

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
}

const pct = (v: number) => v; // fractions are already 0-1, kept as a named no-op for clarity at call sites

export function validateMixing(components: { mixingPct: number }[], tolerancePct = 0.5): { ok: boolean; total: number } {
  const total = components.reduce((s, c) => s + c.mixingPct, 0);
  return { ok: Math.abs(total - 100) <= tolerancePct, total };
}

export function computeCosting(input: CostingInput): CostingBreakup {
  const {
    weavingWastagePct,
    weavingSizingCostPerKg,
    firstVelourCharges,
    firstVelourLossPct,
    secondVelourCharges,
    secondVelourLossPct,
    weightLossPct,
    transportLocalPerKg,
    rejectionPct,
    yarnComponents,
    processingChargeRatePerKg,
    stitchingCostPerKg,
    packingCostPerKg,
    accessories,
    freightExportPerKg,
    wcInterestPct,
    lcInterestPct,
    marginPct,
    commissionPct,
    lengthCm,
    widthCm,
    gsm,
    qtyPcs,
    exchangeRates,
  } = input;

  // --- BOM waste-compounding chain (sheet cols H1:J7) ---
  // J2 = 1 (base), then each stage divides by (1 - waste%) to find how much
  // input material is needed upstream to yield 1kg of good output downstream.
  const j2 = 1;
  const j3 = j2 / (1 - pct(weavingWastagePct));
  const j4 = j3 / (1 - pct(firstVelourLossPct));
  const j5 = j4 / (1 - pct(weightLossPct));
  const j6 = j5 / (1 - pct(secondVelourLossPct));
  const j7 = j6 / (1 - pct(rejectionPct));
  const bomMultiplier = j7; // G8

  // --- Yarn cost (rows 4-8) ---
  const yarnCostPerKg = yarnComponents.reduce(
    (sum, c) => sum + (bomMultiplier * c.pricePerKg * c.mixingPct) / 100,
    0,
  );

  // --- Piece weight & accessories-per-kg (needed before stitching cost) ---
  const pieceWeightGrams = (lengthCm * widthCm * gsm) / 10000;
  const accessoriesPerPiece = accessories.reduce((s, a) => s + a.costPerPiece, 0);
  const accessoriesPerKg = pieceWeightGrams > 0 ? (1000 / pieceWeightGrams) * accessoriesPerPiece : 0;
  const stitchingPackingPerKg = stitchingCostPerKg + packingCostPerKg + accessoriesPerKg;

  // --- Running yield after each stage (G column) ---
  const g8 = bomMultiplier;
  const g9 = g8 - g8 * weavingWastagePct; // after weaving wastage
  const g13 = g9 - g9 * firstVelourLossPct; // after first velour loss
  const g16 = g13 - g13 * weightLossPct; // after weight loss
  const g19 = g16 - g16 * secondVelourLossPct; // after second velour loss
  const g23 = g19 - g19 * rejectionPct; // after rejection

  // --- Cost stack (F column) ---
  const weavingSizingCostLine = g9 * weavingSizingCostPerKg; // F10
  const firstVelourChargesLine = g9 * firstVelourCharges; // F11
  const subtotalAfterWeaving = yarnCostPerKg + weavingSizingCostLine + firstVelourChargesLine; // F12

  const processingChargesLine = g13 * processingChargeRatePerKg; // F14
  const subtotalAfterProcessing = subtotalAfterWeaving + processingChargesLine; // F15

  const secondVelourChargesLine = g16 * secondVelourCharges; // F17
  const subtotalAfterSecondVelour = subtotalAfterProcessing + secondVelourChargesLine; // F18

  const transportLocalLine = transportLocalPerKg * g9; // F20 (uses G9, per original sheet)
  const stitchingPackingLine = g19 * stitchingPackingPerKg; // F21
  const subtotalAfterStitching = subtotalAfterSecondVelour + transportLocalLine + stitchingPackingLine; // F22

  // rejection (F24 = F22, only reduces yield used for freight below)

  const wcInterestLine = subtotalAfterStitching / (1 - wcInterestPct) - subtotalAfterStitching; // F25
  const freightExportLine = freightExportPerKg * g23; // F26
  const subtotalAfterFreight = subtotalAfterStitching + wcInterestLine + freightExportLine; // F27

  const lcInterestLine = subtotalAfterFreight / (1 - lcInterestPct) - subtotalAfterFreight; // F28
  const subtotalBeforeMargin = subtotalAfterFreight + lcInterestLine; // F29

  // Stepwise margin/commission (F30-F32), shown for transparency in the breakup.
  const marginLine = subtotalBeforeMargin * marginPct; // F30
  const subtotalAfterMargin = subtotalBeforeMargin + marginLine; // F31
  const commissionLine = subtotalAfterMargin / (1 - commissionPct) - subtotalAfterMargin; // F32

  // Authoritative "Final Price in INR" (F33) - NOT the stepwise F31+F32, matches
  // the sheet's direct formula: F29 / (1 - (margin% + commission%)).
  const finalPricePerKgInr = subtotalBeforeMargin / (1 - (marginPct + commissionPct));

  const qtyKg = (pieceWeightGrams * qtyPcs) / 1000;

  const ratePerKg: Record<string, number> = {};
  const ratePerPiece: Record<string, number> = {};
  for (const [currency, rateToInr] of Object.entries(exchangeRates)) {
    const perKg = currency === 'INR' ? finalPricePerKgInr : finalPricePerKgInr / rateToInr;
    ratePerKg[currency] = perKg;
    ratePerPiece[currency] = (perKg * pieceWeightGrams) / 1000;
  }

  return {
    bomMultiplier,
    yarnCostPerKg,
    weavingSizingCostPerKg: weavingSizingCostLine,
    firstVelourChargesPerKg: firstVelourChargesLine,
    subtotalAfterWeaving,
    processingChargesPerKg: processingChargesLine,
    subtotalAfterProcessing,
    secondVelourChargesPerKg: secondVelourChargesLine,
    subtotalAfterSecondVelour,
    transportLocalPerKg: transportLocalLine,
    accessoriesPerKg,
    stitchingPackingPerKg: stitchingPackingLine,
    subtotalAfterStitching,
    wcInterestPerKg: wcInterestLine,
    freightExportPerKg: freightExportLine,
    subtotalAfterFreight,
    lcInterestPerKg: lcInterestLine,
    subtotalBeforeMargin,
    marginPerKg: marginLine,
    subtotalAfterMargin,
    commissionPerKg: commissionLine,
    finalPricePerKgInr,
    pieceWeightGrams,
    qtyKg,
    ratePerKg,
    ratePerPiece,
  };
}
