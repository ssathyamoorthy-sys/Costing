import { prisma } from '../lib/prisma';
import { resolveCurrentRate } from '../lib/rates';
import { getCurrentExchangeRates } from '../lib/exchangeRates';
import { computeCosting, type CostingBreakup, type AccessoryInput } from './engine';

export interface ItemAccessoryOverrideInput {
  accessoryTypeId: number;
  costPerPiece: number;
}
export interface ItemPackagingChargeInput {
  description: string;
  ratePerPiece: number;
}
export interface ItemInput {
  itemTypeId: number;
  lengthCm: number;
  widthCm: number;
  // Garment items only (Item Type sizingMethod = FABRIC_CONSUMPTION, e.g. bathrobes) -
  // fabric required per piece in sq.m, used instead of lengthCm x widthCm.
  fabricConsumptionSqm?: number | null;
  gsm: number;
  qtyPerSet: number;
  hsnCodeId?: number | null;
  accessoryOverrides?: ItemAccessoryOverrideInput[];
  packagingCharges?: ItemPackagingChargeInput[];
  // Per-item overrides of the Item Type master's stitching/packing cost - see schema.prisma.
  stitchingCostPerKgOverride?: number | null;
  stitchingCostPerPieceOverride?: number | null;
  packingCostPerKgOverride?: number | null;
}
export interface SegmentYarnInput {
  slot: string;
  rawMaterialId: number;
  mixingPct: number;
  // Yarn-dyed only: cost/kg to dye this slot - see schema.prisma.
  dyeingCostPerKg?: number;
}
export interface SegmentInput {
  productId: number;
  yarnComponents: SegmentYarnInput[];
  items: ItemInput[];
}
export interface SetInput {
  quoteId: number;
  color: string;
  segments: SegmentInput[];
  // when recomputing an existing set (edits, material overrides), pass the existing line id
  // so per-segment material overrides already on file are picked up
  quoteLineId?: number;
}

export interface ComputedItem extends ItemInput {
  pieceWeightGrams: number;
  qtyKg: number;
  breakup: CostingBreakup;
}
export interface ComputedSegment {
  productId: number;
  yarnComponents: SegmentYarnInput[];
  items: ComputedItem[];
}
export interface SetComputationResult {
  segments: ComputedSegment[];
  ratePerSet: Record<string, number>; // combined set price = sum of (item unit ratePerPiece * qtyPerSet)
  warnings: string[];
}

/**
 * Costs every item in every segment of a "Set" (a quote line). Each segment shares one
 * yarn recipe (with segment-level raw-material overrides) and one Product's process
 * parameters (weaving wastage, velour, transport, rejection); each item within it is
 * costed independently off its own size, using that shared recipe.
 */
export async function computeSet(input: SetInput): Promise<SetComputationResult> {
  const warnings: string[] = [];

  const quote = await prisma.quote.findUnique({ where: { id: input.quoteId }, include: { customer: true } });
  if (!quote) throw new Error(`Quote ${input.quoteId} not found`);
  const customer = quote.customer;

  // Per-Set margin override (from "Match target price") wins over the quote-wide override,
  // which wins over the customer default.
  const line = input.quoteLineId ? await prisma.quoteLine.findUnique({ where: { id: input.quoteLineId } }) : null;
  const marginPct = line?.marginPctOverride ?? quote.marginPctOverride ?? customer.marginPct;

  const freightSetting = await prisma.generalSetting.findUnique({ where: { key: 'freightExportPerKg' } });
  const masterFreightExportPerKg = freightSetting ? Number(freightSetting.value) : 0;
  if (!freightSetting) {
    warnings.push('No "freightExportPerKg" general setting configured yet - export freight costed as 0/kg.');
  }
  const freightExportPerKg = quote.freightExportPerKgOverride ?? masterFreightExportPerKg;

  const allRates = await getCurrentExchangeRates();
  const exchangeRates: Record<string, number> = { INR: 1 };
  if (quote.currency !== 'INR') {
    if (!(quote.currency in allRates)) {
      warnings.push(`No exchange rate on file for ${quote.currency}; that currency will be skipped.`);
    } else {
      exchangeRates[quote.currency] = allRates[quote.currency];
    }
  }

  // Segment-level material overrides already on file, keyed by segment id (only relevant
  // when recomputing an existing set, e.g. after a supervisor override or a line edit).
  const existingSegments = input.quoteLineId
    ? await prisma.quoteLineSegment.findMany({
        where: { quoteLineId: input.quoteLineId },
        include: { materialOverrides: true, product: true },
      })
    : [];

  const computedSegments: ComputedSegment[] = [];

  for (const segInput of input.segments) {
    const product = await prisma.product.findUnique({
      where: { id: segInput.productId },
      include: { accessories: { include: { accessoryType: true } } },
    });
    if (!product) throw new Error(`Product ${segInput.productId} not found`);

    // Match this segment to any existing one on file (same product, in order) so a
    // recompute after editing picks up the right material overrides.
    const matchedExisting = existingSegments.find((s) => s.productId === segInput.productId);
    const overrideByMaterialId = new Map(
      (matchedExisting?.materialOverrides ?? []).map((o) => [o.rawMaterialId, o.overridePricePerKg]),
    );
    // Per-segment overrides win over the Product master (see schema.prisma).
    const weavingSizingCostPerKg = matchedExisting?.weavingSizingCostPerKgOverride ?? product.weavingSizingCostPerKg;
    const firstVelourCharges = matchedExisting?.firstVelourChargesOverride ?? product.firstVelourCharges;
    const secondVelourCharges = matchedExisting?.secondVelourChargesOverride ?? product.secondVelourCharges;
    const transportLocalPerKg = matchedExisting?.transportLocalPerKgOverride ?? product.transportLocalPerKg;
    const washingCostPerKg = matchedExisting?.washingCostPerKgOverride ?? product.washingCostPerKg;

    const isYarnDyed = product.colorMethod === 'YARN_DYED';
    // Piece-dyed only: the flat Processing Charge master (by color) - yarn-dyed products
    // dye the yarn itself instead (dyeingCostPerKg per slot, resolved by the caller into
    // segInput.yarnComponents), so this lookup - and its "configure it first" requirement -
    // simply doesn't apply to them.
    let processingChargeRatePerKg = 0;
    if (!isYarnDyed) {
      const processingCharge = await prisma.processingCharge.findFirst({ where: { color: { equals: input.color } } });
      if (!processingCharge) {
        throw new Error(`No processing charge configured for color "${input.color}". Add it in General Mapping first.`);
      }
      // Per-Set override wins over the Processing Charge master (see schema.prisma).
      processingChargeRatePerKg = line?.processingChargeRatePerKgOverride ?? processingCharge.ratePerKg;
    }

    const mixingTotal = segInput.yarnComponents.reduce((s, c) => s + c.mixingPct, 0);
    if (Math.abs(mixingTotal - 100) > 0.5) {
      throw new Error(`${product.code}: yarn mixing % totals ${mixingTotal.toFixed(1)}%, must total 100% (within 0.5%) before this set can be priced.`);
    }

    const resolvedYarn: { slot: string; mixingPct: number; pricePerKg: number; dyeingCostPerKg: number }[] = [];
    for (const c of segInput.yarnComponents) {
      const dyeingCostPerKg = c.dyeingCostPerKg ?? 0;
      const override = overrideByMaterialId.get(c.rawMaterialId);
      if (override != null) {
        resolvedYarn.push({ slot: c.slot, mixingPct: c.mixingPct, pricePerKg: override, dyeingCostPerKg });
        continue;
      }
      const resolved = await resolveCurrentRate(c.rawMaterialId);
      if (!resolved) {
        const material = await prisma.rawMaterial.findUnique({ where: { id: c.rawMaterialId } });
        throw new Error(`No approved rate exists yet for raw material "${material?.code ?? c.rawMaterialId}"`);
      }
      if (resolved.isStale) {
        const material = await prisma.rawMaterial.findUnique({ where: { id: c.rawMaterialId } });
        warnings.push(
          `Rate for "${material?.code}" expired on ${resolved.validTo?.toDateString()} - using last known price ${resolved.pricePerKg}/kg.`,
        );
      }
      resolvedYarn.push({ slot: c.slot, mixingPct: c.mixingPct, pricePerKg: resolved.pricePerKg, dyeingCostPerKg });
    }

    const computedItems: ComputedItem[] = [];
    for (const itemInput of segInput.items) {
      const itemType = await prisma.itemType.findUnique({ where: { id: itemInput.itemTypeId } });
      if (!itemType) throw new Error(`Item type ${itemInput.itemTypeId} not found`);

      const overrideByAccessoryTypeId = new Map((itemInput.accessoryOverrides ?? []).map((o) => [o.accessoryTypeId, o.costPerPiece]));
      const finalAccessories: AccessoryInput[] = product.accessories.map((a) => ({
        name: a.accessoryType.name,
        costPerPiece: overrideByAccessoryTypeId.get(a.accessoryTypeId) ?? a.costPerPiece,
      }));
      for (const o of itemInput.accessoryOverrides ?? []) {
        if (!product.accessories.some((a) => a.accessoryTypeId === o.accessoryTypeId)) {
          const at = await prisma.accessoryType.findUnique({ where: { id: o.accessoryTypeId } });
          finalAccessories.push({ name: at?.name ?? `Accessory ${o.accessoryTypeId}`, costPerPiece: o.costPerPiece });
        }
      }
      for (const p of itemInput.packagingCharges ?? []) {
        finalAccessories.push({ name: p.description, costPerPiece: p.ratePerPiece });
      }

      let hsnCode: string | null = null;
      let totalIncentivePct = 0;
      if (itemInput.hsnCodeId) {
        const hsn = await prisma.hsnCode.findUnique({ where: { id: itemInput.hsnCodeId } });
        if (hsn) {
          hsnCode = hsn.hsCode;
          totalIncentivePct = hsn.dbkPct + hsn.rosctlRodepPct;
        }
      }

      const isGarment = itemType.sizingMethod === 'FABRIC_CONSUMPTION';

      const breakup = computeCosting({
        colorMethod: isYarnDyed ? 'YARN_DYED' : 'PIECE_DYED',
        itemClass: isGarment ? 'GARMENT' : 'FLAT',
        weavingWastagePct: product.weavingWastagePct,
        weavingSizingCostPerKg,
        firstVelourCharges,
        firstVelourLossPct: product.firstVelourLossPct,
        secondVelourCharges,
        secondVelourLossPct: product.secondVelourLossPct,
        transportLocalPerKg,
        rejectionPct: product.rejectionPct,
        secondRejectionPct: product.secondRejectionPct,
        yarnComponents: resolvedYarn,
        processingChargeRatePerKg,
        weightLossPct: product.weightLossPct,
        yarnDyeingProcessLossPct: product.yarnDyeingProcessLossPct,
        washingCostPerKg,
        washingLossPct: product.washingLossPct,
        stitchingCostPerKg: itemInput.stitchingCostPerKgOverride ?? itemType.stitchingCostPerKg,
        stitchingCostPerPiece: itemInput.stitchingCostPerPieceOverride ?? itemType.stitchingCostPerPiece,
        packingCostPerKg: itemInput.packingCostPerKgOverride ?? itemType.packingCostPerKg,
        accessories: finalAccessories,
        freightExportPerKg,
        wcInterestPct: quote.wcInterestPctOverride ?? customer.wcInterestPct,
        lcInterestPct: quote.lcInterestPctOverride ?? customer.lcInterestPct,
        marginPct,
        commissionPct: quote.commissionPctOverride ?? customer.commissionPct,
        lengthCm: itemInput.lengthCm,
        widthCm: itemInput.widthCm,
        fabricConsumptionSqm: itemInput.fabricConsumptionSqm ?? 0,
        gsm: itemInput.gsm,
        qtyPcs: itemInput.qtyPerSet,
        exchangeRates,
      });

      // Duty Drawback / RoDTEP - an internal profit metric only, never added to the price
      // quoted to the customer (ratePerKg/ratePerPiece above are untouched).
      const profitPerKgInr = breakup.finalPricePerKgInr - breakup.subtotalBeforeMargin;
      const dbkProfitPerKgInr = totalIncentivePct * breakup.finalPricePerKgInr;
      const profitInclDbkPerKgInr = profitPerKgInr + dbkProfitPerKgInr;
      const profitInclDbk: Record<string, number> = {};
      for (const [currency, rateToInr] of Object.entries(exchangeRates)) {
        const perKg = currency === 'INR' ? profitInclDbkPerKgInr : profitInclDbkPerKgInr / rateToInr;
        profitInclDbk[currency] = (perKg * breakup.pieceWeightGrams) / 1000;
      }

      computedItems.push({
        ...itemInput,
        pieceWeightGrams: breakup.pieceWeightGrams,
        qtyKg: breakup.qtyKg,
        breakup: {
          ...breakup,
          hsnCode,
          totalIncentivePct,
          profitPerKgInr,
          dbkProfitPerKgInr,
          profitInclDbkPerKgInr,
          profitInclDbk,
          marginPct,
          effectiveMarginPctInclDbk: marginPct + totalIncentivePct,
        },
      });
    }

    computedSegments.push({ productId: segInput.productId, yarnComponents: segInput.yarnComponents, items: computedItems });
  }

  const ratePerSet: Record<string, number> = {};
  for (const currency of Object.keys(exchangeRates)) {
    let total = 0;
    for (const seg of computedSegments) {
      for (const item of seg.items) {
        total += (item.breakup.ratePerPiece[currency] ?? 0) * item.qtyPerSet;
      }
    }
    ratePerSet[currency] = total;
  }

  return { segments: computedSegments, ratePerSet, warnings };
}
