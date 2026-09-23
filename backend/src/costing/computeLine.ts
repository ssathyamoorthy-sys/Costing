import { prisma } from '../lib/prisma';
import { resolveCurrentRate } from '../lib/rates';
import { getCurrentExchangeRates } from '../lib/exchangeRates';
import { computeCosting, type CostingBreakup } from './engine';

export interface LineInputArgs {
  productId: number;
  itemTypeId: number;
  customerId: number;
  color: string;
  lengthCm: number;
  widthCm: number;
  gsm: number;
  qtyPcs: number;
  currencies: string[]; // e.g. ['INR','USD','GBP']
  quoteLineId?: number; // when recomputing an existing line, to pick up its overrides
}

export interface LineComputationResult {
  breakup: CostingBreakup;
  warnings: string[];
}

export async function computeQuoteLine(args: LineInputArgs): Promise<LineComputationResult> {
  const warnings: string[] = [];

  const product = await prisma.product.findUnique({
    where: { id: args.productId },
    include: {
      yarnComponents: { include: { rawMaterial: true } },
      accessories: { include: { accessoryType: true } },
    },
  });
  if (!product) throw new Error(`Product ${args.productId} not found`);

  const itemType = await prisma.itemType.findUnique({ where: { id: args.itemTypeId } });
  if (!itemType) throw new Error(`Item type ${args.itemTypeId} not found`);

  const customer = await prisma.customer.findUnique({ where: { id: args.customerId } });
  if (!customer) throw new Error(`Customer ${args.customerId} not found`);

  const materialOverrides = args.quoteLineId
    ? await prisma.quoteLineMaterialOverride.findMany({ where: { quoteLineId: args.quoteLineId } })
    : [];
  const overrideByMaterialId = new Map(materialOverrides.map((o) => [o.rawMaterialId, o.overridePricePerKg]));

  const yarnComponents = [];
  for (const c of product.yarnComponents) {
    const override = overrideByMaterialId.get(c.rawMaterialId);
    if (override != null) {
      yarnComponents.push({ slot: c.slot, mixingPct: c.mixingPct, pricePerKg: override });
      continue;
    }
    const resolved = await resolveCurrentRate(c.rawMaterialId);
    if (!resolved) {
      throw new Error(`No approved rate exists yet for raw material "${c.rawMaterial.code}"`);
    }
    if (resolved.isStale) {
      warnings.push(`Rate for "${c.rawMaterial.code}" expired on ${resolved.validTo?.toDateString()} - using last known price ₹${resolved.pricePerKg}/kg.`);
    }
    yarnComponents.push({ slot: c.slot, mixingPct: c.mixingPct, pricePerKg: resolved.pricePerKg });
  }

  const processingCharge = await prisma.processingCharge.findFirst({
    where: { color: { equals: args.color } },
  });
  if (!processingCharge) {
    throw new Error(`No processing charge configured for color "${args.color}". Add it in General Mapping first.`);
  }

  const accessoryOverrides = args.quoteLineId
    ? await prisma.quoteLineAccessory.findMany({ where: { quoteLineId: args.quoteLineId }, include: { accessoryType: true } })
    : [];
  const overrideByAccessoryTypeId = new Map(accessoryOverrides.map((o) => [o.accessoryTypeId, o.costPerPiece]));
  const accessories = product.accessories.map((a) => ({
    name: a.accessoryType.name,
    costPerPiece: overrideByAccessoryTypeId.get(a.accessoryTypeId) ?? a.costPerPiece,
  }));
  // include any accessory overrides for accessory types the product has no default for
  for (const o of accessoryOverrides) {
    if (!product.accessories.some((a) => a.accessoryTypeId === o.accessoryTypeId)) {
      accessories.push({ name: o.accessoryType.name, costPerPiece: o.costPerPiece });
    }
  }

  const freightSetting = await prisma.generalSetting.findUnique({ where: { key: 'freightExportPerKg' } });
  const freightExportPerKg = freightSetting ? Number(freightSetting.value) : 0;
  if (!freightSetting) {
    warnings.push('No "freightExportPerKg" general setting configured yet - export freight costed as ₹0/kg.');
  }

  const allRates = await getCurrentExchangeRates();
  const exchangeRates: Record<string, number> = { INR: 1 };
  for (const currency of args.currencies) {
    if (currency === 'INR') continue;
    if (!(currency in allRates)) {
      warnings.push(`No exchange rate on file for ${currency}; skipping that currency.`);
      continue;
    }
    exchangeRates[currency] = allRates[currency];
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
    yarnComponents,
    processingChargeRatePerKg: processingCharge.ratePerKg,
    stitchingCostPerKg: itemType.stitchingCostPerKg,
    packingCostPerKg: itemType.packingCostPerKg,
    accessories,
    freightExportPerKg,
    wcInterestPct: customer.wcInterestPct,
    lcInterestPct: customer.lcInterestPct,
    marginPct: customer.marginPct,
    commissionPct: customer.commissionPct,
    lengthCm: args.lengthCm,
    widthCm: args.widthCm,
    gsm: args.gsm,
    qtyPcs: args.qtyPcs,
    exchangeRates,
  });

  return { breakup, warnings };
}
