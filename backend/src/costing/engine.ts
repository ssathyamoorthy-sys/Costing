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
  // Yarn-dyed only: cost/kg to dye this slot (different slots can be different shades).
  dyeingCostPerKg?: number;
}

export interface AccessoryInput {
  name: string;
  costPerPiece: number;
}

// PIECE_DYED (default): fabric is dyed as one piece after weaving, via a single flat
// processingChargeRatePerKg (paired with weightLossPct). YARN_DYED: the yarn is dyed
// before weaving - each yarn component carries its own dyeingCostPerKg instead, there's a
// yarnDyeingProcessLossPct stage before weaving, and washing (washingCostPerKg/
// washingLossPct) replaces the processing-charge stage, positioned after weaving.
export type ColorMethod = 'PIECE_DYED' | 'YARN_DYED';

// FLAT (default): a flat item sized by length x width x GSM (towels). GARMENT: a tailored
// item sized by fabric consumption in sq.m instead (bathrobes) - stitching becomes a flat
// per-piece cost rather than one that scales with fabric weight, an optional second
// sequential rejection stage is available, and export freight is costed directly off the
// piece's own weight rather than the kg-chain's post-rejection multiplier.
export type ItemClass = 'FLAT' | 'GARMENT';

export interface CostingInput {
  colorMethod?: ColorMethod; // default PIECE_DYED
  itemClass?: ItemClass; // default FLAT

  // Product-based mapping
  weavingWastagePct: number; // fraction, e.g. 0.025
  weavingSizingCostPerKg: number;
  firstVelourCharges: number;
  firstVelourLossPct: number;
  secondVelourCharges: number;
  secondVelourLossPct: number;
  transportLocalPerKg: number;
  rejectionPct: number;
  // GARMENT only: an optional second, sequential rejection stage (e.g. a bathrobe's
  // post-stitching "final rejection", separate from the fabric-stage rejection above).
  secondRejectionPct?: number; // default 0

  yarnComponents: YarnComponentInput[];

  // PIECE_DYED only (color-driven, paired with weightLossPct below)
  processingChargeRatePerKg?: number; // default 0
  weightLossPct?: number; // default 0

  // YARN_DYED only
  yarnDyeingProcessLossPct?: number; // default 0
  washingCostPerKg?: number; // default 0
  washingLossPct?: number; // default 0

  // Item-type driven (Bath Towel / Hand Towel / Bath Sheet / Face Towel / Bathrobe).
  // FLAT items use stitchingCostPerKg; GARMENT items use stitchingCostPerPiece instead
  // (converted to a per-kg equivalent internally, same trick as accessories below).
  // packingCostPerKg applies to both - it stays genuinely per-kg either way.
  stitchingCostPerKg?: number; // default 0
  stitchingCostPerPiece?: number; // default 0
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

  // Size - FLAT items set lengthCm/widthCm, GARMENT items set fabricConsumptionSqm instead
  lengthCm?: number;
  widthCm?: number;
  fabricConsumptionSqm?: number; // GARMENT only, sq.m of fabric per piece
  gsm: number;
  qtyPcs: number;

  // currency -> INR value of 1 unit of that currency. INR itself should be 1.
  exchangeRates: Record<string, number>;
}

export interface CostingBreakup {
  bomMultiplier: number;
  yarnCostPerKg: number;
  // Yarn-dyed only: per-kg dyeing cost contribution (0 for piece-dyed).
  dyeingCostPerKg: number;
  weavingSizingCostPerKg: number;
  firstVelourChargesPerKg: number;
  subtotalAfterWeaving: number;
  // Piece-dyed: the flat processing charge. Yarn-dyed: the washing charge, in the same
  // chain position (one or the other is always 0).
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

  // Duty Drawback / RoDTEP incentive - an internal profit metric only, computed in
  // computeSet.ts (needs a DB lookup of the chosen HsnCode, so it's outside this pure
  // function). Never changes ratePerKg/ratePerPiece, the price actually quoted.
  hsnCode?: string | null;
  totalIncentivePct?: number;
  profitPerKgInr?: number; // finalPricePerKgInr - subtotalBeforeMargin (true grossed-up profit)
  dbkProfitPerKgInr?: number; // totalIncentivePct * finalPricePerKgInr
  profitInclDbkPerKgInr?: number;
  profitInclDbk?: Record<string, number>; // per currency, per piece - profit + DBK incentive

  // The plain margin used to price this item, and that margin plus the DBK/ROSCTL
  // incentive - a display-only figure showing the effective margin once the export
  // incentive is folded in. Never fed back into the pricing formula above.
  marginPct?: number;
  effectiveMarginPctInclDbk?: number;
}

const pct = (v: number) => v; // fractions are already 0-1, kept as a named no-op for clarity at call sites

export function validateMixing(components: { mixingPct: number }[], tolerancePct = 0.5): { ok: boolean; total: number } {
  const total = components.reduce((s, c) => s + c.mixingPct, 0);
  return { ok: Math.abs(total - 100) <= tolerancePct, total };
}

export function computeCosting(input: CostingInput): CostingBreakup {
  const {
    colorMethod = 'PIECE_DYED',
    itemClass = 'FLAT',
    weavingWastagePct,
    weavingSizingCostPerKg,
    firstVelourCharges,
    firstVelourLossPct,
    secondVelourCharges,
    secondVelourLossPct,
    transportLocalPerKg,
    rejectionPct,
    secondRejectionPct = 0,
    yarnComponents,
    processingChargeRatePerKg = 0,
    weightLossPct = 0,
    yarnDyeingProcessLossPct = 0,
    washingCostPerKg = 0,
    washingLossPct = 0,
    stitchingCostPerKg = 0,
    stitchingCostPerPiece = 0,
    packingCostPerKg,
    accessories,
    freightExportPerKg,
    wcInterestPct,
    lcInterestPct,
    marginPct,
    commissionPct,
    lengthCm = 0,
    widthCm = 0,
    fabricConsumptionSqm = 0,
    gsm,
    qtyPcs,
    exchangeRates,
  } = input;

  const isYarnDyed = colorMethod === 'YARN_DYED';
  const isGarment = itemClass === 'GARMENT';
  // Piece-dyed uses the flat processing charge, paired with weightLossPct, in this chain
  // position; yarn-dyed uses washing instead, in the same position, since the fabric is
  // already dyed (as yarn) before it ever gets here.
  const processingOrWashingRatePerKg = isYarnDyed ? washingCostPerKg : processingChargeRatePerKg;
  const processingOrWashingLossPct = isYarnDyed ? washingLossPct : weightLossPct;

  // --- BOM waste-compounding chain (sheet cols H1:J7, extended for yarn-dyed/garment) ---
  // J2 = 1 (base), then each stage divides by (1 - waste%) to find how much input
  // material is needed upstream to yield 1kg of good output downstream. Yarn-dyed adds a
  // loss stage before weaving (the dyeing process itself); garment items can add a second,
  // sequential rejection stage at the end (e.g. a bathrobe's post-stitching rejection).
  let j = 1;
  if (isYarnDyed) j = j / (1 - pct(yarnDyeingProcessLossPct));
  j = j / (1 - pct(weavingWastagePct));
  j = j / (1 - pct(firstVelourLossPct));
  j = j / (1 - pct(processingOrWashingLossPct));
  j = j / (1 - pct(secondVelourLossPct));
  j = j / (1 - pct(rejectionPct));
  if (isGarment && secondRejectionPct) j = j / (1 - pct(secondRejectionPct));
  const bomMultiplier = j; // G8

  // --- Yarn + dyeing cost (rows 4-8) ---
  const yarnCostPerKg = yarnComponents.reduce(
    (sum, c) => sum + (bomMultiplier * c.pricePerKg * c.mixingPct) / 100,
    0,
  );
  const dyeingCostPerKg = isYarnDyed
    ? yarnComponents.reduce((sum, c) => sum + (bomMultiplier * (c.dyeingCostPerKg ?? 0) * c.mixingPct) / 100, 0)
    : 0;

  // --- Piece weight & accessories-per-kg (needed before stitching cost) ---
  // Flat items (towels): L x W x GSM. Garment items (bathrobes): a tailored pattern isn't a
  // simple rectangle, so fabric consumption per piece (sq.m) is entered directly instead.
  const pieceWeightGrams = isGarment ? fabricConsumptionSqm * gsm : (lengthCm * widthCm * gsm) / 10000;
  const accessoriesPerPiece = accessories.reduce((s, a) => s + a.costPerPiece, 0);
  const accessoriesPerKg = pieceWeightGrams > 0 ? (1000 / pieceWeightGrams) * accessoriesPerPiece : 0;
  // Garment stitching is a flat per-piece labor cost, not one that scales with fabric
  // weight - converted to a per-kg equivalent the same way accessories are, above.
  const stitchingCostPerKgEquivalent = isGarment
    ? pieceWeightGrams > 0
      ? (1000 / pieceWeightGrams) * stitchingCostPerPiece
      : 0
    : stitchingCostPerKg;
  const stitchingPackingPerKg = stitchingCostPerKgEquivalent + packingCostPerKg + accessoriesPerKg;

  // --- Running yield after each stage (G column) ---
  const g8 = bomMultiplier;
  const gAfterDyeing = isYarnDyed ? g8 - g8 * yarnDyeingProcessLossPct : g8;
  const g9 = gAfterDyeing - gAfterDyeing * weavingWastagePct; // after weaving wastage
  const g13 = g9 - g9 * firstVelourLossPct; // after first velour loss
  const g16 = g13 - g13 * processingOrWashingLossPct; // after processing/washing loss
  const g19 = g16 - g16 * secondVelourLossPct; // after second velour loss
  const g23 = g19 - g19 * rejectionPct; // after rejection
  // No further forward-chain stage is needed for secondRejectionPct: in the reference
  // bathrobe sheet, nothing downstream reads the post-second-rejection yield - its only
  // real effect is already captured via bomMultiplier (yarn is bought accounting for it).

  // --- Cost stack (F column) ---
  const weavingSizingCostLine = g9 * weavingSizingCostPerKg; // F10
  const firstVelourChargesLine = g9 * firstVelourCharges; // F11
  const subtotalAfterWeaving = yarnCostPerKg + dyeingCostPerKg + weavingSizingCostLine + firstVelourChargesLine; // F12

  const processingChargesLine = g13 * processingOrWashingRatePerKg; // F14
  const subtotalAfterProcessing = subtotalAfterWeaving + processingChargesLine; // F15

  const secondVelourChargesLine = g16 * secondVelourCharges; // F17
  const subtotalAfterSecondVelour = subtotalAfterProcessing + secondVelourChargesLine; // F18

  const transportLocalLine = transportLocalPerKg * g9; // F20 (uses G9, per original sheet)
  const stitchingPackingLine = g19 * stitchingPackingPerKg; // F21
  const subtotalAfterStitching = subtotalAfterSecondVelour + transportLocalLine + stitchingPackingLine; // F22

  // rejection (F24 = F22, only reduces yield used for freight below)

  const wcInterestLine = subtotalAfterStitching / (1 - wcInterestPct) - subtotalAfterStitching; // F25
  // Flat items: freight is costed on the fully-reduced post-rejection kg yield (G23), same
  // as every other process charge. Garment items: by this point the chain is already
  // working per finished piece (its weight is already final), so freight is costed
  // directly off the piece's own weight instead - see the reference bathrobe sheet, where
  // export freight is piece-weight x rate/kg with no further multiplier.
  const freightExportLine = isGarment ? freightExportPerKg : freightExportPerKg * g23; // F26
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
    dyeingCostPerKg,
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
