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
  gsm: number;
  qtyPerSet: number;
  hsnCodeId?: number | null;
  accessoryOverrides?: ItemAccessoryOverrideInput[];
  packagingCharges?: ItemPackagingChargeInput[];
}
export interface SegmentYarnInput {
  slot: string;
  rawMaterialId: number;
  mixingPct: number;
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

  const freightSetting = await prisma.generalSetting.findUnique({ where: { key: 'freightExportPerKg' } });
  const freightExportPerKg = freightSetting ? Number(freightSetting.value) : 0;
  if (!freightSetting) {
    warnings.push('No "freightExportPerKg" general setting configured yet - export freight costed as 0/kg.');
  }

  const processingCharge = await prisma.processingCharge.findFirst({ where: { color: { equals: input.color } } });
  if (!processingCharge) {
    throw new Error(`No processing charge configured for color "${input.color}". Add it in General Mapping first.`);
  }

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

    const mixingTotal = segInput.yarnComponents.reduce((s, c) => s + c.mixingPct, 0);
    if (Math.abs(mixingTotal - 100) > 0.5) {
      warnings.push(`${product.code}: yarn mixing % totals ${mixingTotal.toFixed(1)}, expected 100.`);
    }

    const resolvedYarn: { slot: string; mixingPct: number; pricePerKg: number }[] = [];
    for (const c of segInput.yarnComponents) {
      const override = overrideByMaterialId.get(c.rawMaterialId);
      if (override != null) {
        resolvedYarn.push({ slot: c.slot, mixingPct: c.mixingPct, pricePerKg: override });
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
      resolvedYarn.push({ slot: c.slot, mixingPct: c.mixingPct, pricePerKg: resolved.pricePerKg });
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

      const breakup = computeCosting({
        weavingWastagePct: product.weavingWastagePct,
        weavingSizingCostPerKg: product.weavingSizingCostPerKg,
        firstVelourCharges: product.firstVelourCharges,
        firstVelourLossPct: product.firstVelourLossPct,
        secondVelourCharges: product.secondVelourCharges,
        secondVelourLossPct: product.secondVelourLossPct,
        weightLossPct: product.weightLossPct,
        transportLocalPerKg: product.transportLocalPerKg,
        rejectionPct: product.rejectionPct,
        yarnComponents: resolvedYarn,
        processingChargeRatePerKg: processingCharge.ratePerKg,
        stitchingCostPerKg: itemType.stitchingCostPerKg,
        packingCostPerKg: itemType.packingCostPerKg,
        accessories: finalAccessories,
        freightExportPerKg,
        wcInterestPct: quote.wcInterestPctOverride ?? customer.wcInterestPct,
        lcInterestPct: quote.lcInterestPctOverride ?? customer.lcInterestPct,
        marginPct: quote.marginPctOverride ?? customer.marginPct,
        commissionPct: quote.commissionPctOverride ?? customer.commissionPct,
        lengthCm: itemInput.lengthCm,
        widthCm: itemInput.widthCm,
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
        breakup: { ...breakup, hsnCode, totalIncentivePct, profitPerKgInr, dbkProfitPerKgInr, profitInclDbkPerKgInr, profitInclDbk },
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
