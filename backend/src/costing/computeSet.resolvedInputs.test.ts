import { describe, expect, it, vi } from 'vitest';

// buildComputedItemFromResolvedInputs does two small, structural (non-rate) DB lookups -
// Item Type (sizing method, stitching/packing cost) and HSN Code (DBK %) - see its own doc
// comment in computeSet.ts for why those aren't part of ResolvedCostInputs. Mocked here so
// the cascade math itself can be tested without a seeded DB.
vi.mock('../lib/prisma', () => ({
  prisma: {
    itemType: {
      findUnique: vi.fn().mockResolvedValue({ id: 1, sizingMethod: 'DIMENSIONS', stitchingCostPerKg: 5, stitchingCostPerPiece: 0, packingCostPerKg: 2 }),
    },
    hsnCode: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

import {
  buildComputedItemFromResolvedInputs,
  mergeResolvedInputs,
  componentChanged,
  componentValue,
  COST_COMPONENT_KEYS,
  type ResolvedCostInputs,
  type ItemInput,
} from './computeSet';

function baseResolvedInputs(overrides: Partial<ResolvedCostInputs> = {}): ResolvedCostInputs {
  return {
    yarnComponents: [{ slot: 'Pile', rawMaterialId: 1, mixingPct: 100, pricePerKg: 200, dyeingCostPerKg: 0 }],
    weavingSizingCostPerKg: 10,
    firstVelourCharges: 0,
    firstVelourLossPct: 0,
    secondVelourCharges: 0,
    secondVelourLossPct: 0,
    transportLocalPerKg: 1,
    processingChargeRatePerKg: 15,
    washingCostPerKg: 0,
    weavingWastagePct: 0.02,
    weightLossPct: 0.01,
    washingLossPct: 0,
    yarnDyeingProcessLossPct: 0,
    rejectionPct: 0.03,
    secondRejectionPct: 0,
    freightExportPerKg: 5,
    accessories: [],
    exchangeRates: { INR: 1 },
    ...overrides,
  };
}

const item: ItemInput = {
  itemTypeId: 1,
  lengthCm: 70,
  widthCm: 140,
  gsm: 500,
  qtyPerSet: 100,
  hsnCodeId: null,
};

const oldRi = baseResolvedInputs();
const newRi = baseResolvedInputs({
  yarnComponents: [{ slot: 'Pile', rawMaterialId: 1, mixingPct: 100, pricePerKg: 220, dyeingCostPerKg: 0 }],
  processingChargeRatePerKg: 18,
});

async function build(ri: ResolvedCostInputs) {
  return buildComputedItemFromResolvedInputs({
    itemInput: item,
    isYarnDyed: false,
    resolvedInputs: ri,
    marginPct: 0.15,
    commissionPct: 0.02,
    wcInterestPct: 0.01,
    lcInterestPct: 0.01,
  });
}

describe('componentChanged / componentValue', () => {
  it('detects no changes between two identical snapshots', () => {
    for (const key of COST_COMPONENT_KEYS) {
      expect(componentChanged(key, oldRi, oldRi)).toBe(false);
    }
  });

  it('detects the yarn and processing changes between oldRi and newRi, nothing else', () => {
    expect(componentChanged('yarn', oldRi, newRi)).toBe(true);
    expect(componentChanged('processing', oldRi, newRi)).toBe(true);
    expect(componentChanged('weaving', oldRi, newRi)).toBe(false);
    expect(componentChanged('freight', oldRi, newRi)).toBe(false);
    expect(componentChanged('yieldRejection', oldRi, newRi)).toBe(false);
  });

  it('reports a bundled yieldRejection change when any one of its fields differs', () => {
    const tweaked = baseResolvedInputs({ rejectionPct: 0.08 });
    expect(componentChanged('yieldRejection', oldRi, tweaked)).toBe(true);
    expect(componentValue('yieldRejection', tweaked, 'INR')).toBeCloseTo(0.08);
  });
});

describe('mergeResolvedInputs', () => {
  it('accepting no keys keeps every field at its old value', () => {
    const merged = mergeResolvedInputs(oldRi, newRi, new Set());
    expect(merged).toEqual(oldRi);
  });

  it('accepting every key reproduces the new snapshot exactly', () => {
    const merged = mergeResolvedInputs(oldRi, newRi, new Set(COST_COMPONENT_KEYS));
    expect(merged).toEqual(newRi);
  });

  it('accepting just "yarn" takes the new yarn rate but leaves processing (and everything else) at the old value', () => {
    const merged = mergeResolvedInputs(oldRi, newRi, new Set(['yarn']));
    expect(merged.yarnComponents[0].pricePerKg).toBe(220);
    expect(merged.processingChargeRatePerKg).toBe(15);
    expect(merged.weavingSizingCostPerKg).toBe(oldRi.weavingSizingCostPerKg);
  });
});

describe('buildComputedItemFromResolvedInputs', () => {
  it('accepting no components reproduces the old breakup exactly', async () => {
    const merged = mergeResolvedInputs(oldRi, newRi, new Set());
    const [fromMerge, fromOld] = await Promise.all([build(merged), build(oldRi)]);
    expect(fromMerge.breakup.ratePerKg.INR).toBeCloseTo(fromOld.breakup.ratePerKg.INR, 10);
  });

  it('accepting every component reproduces the new breakup exactly', async () => {
    const merged = mergeResolvedInputs(oldRi, newRi, new Set(COST_COMPONENT_KEYS));
    const [fromMerge, fromNew] = await Promise.all([build(merged), build(newRi)]);
    expect(fromMerge.breakup.ratePerKg.INR).toBeCloseTo(fromNew.breakup.ratePerKg.INR, 10);
  });

  it('a mixed selection (accept yarn, keep processing) lands strictly between the pure-old and pure-new price', async () => {
    const merged = mergeResolvedInputs(oldRi, newRi, new Set(['yarn']));
    const [fromOld, fromMixed, fromNew] = await Promise.all([build(oldRi), build(merged), build(newRi)]);
    expect(fromMixed.breakup.ratePerKg.INR).toBeGreaterThan(fromOld.breakup.ratePerKg.INR);
    expect(fromMixed.breakup.ratePerKg.INR).toBeLessThan(fromNew.breakup.ratePerKg.INR);
  });

  it('a mixed selection matches a hand-computed breakup (only the yarn rate swapped, processing charge frozen at old)', async () => {
    const merged = mergeResolvedInputs(oldRi, newRi, new Set(['yarn']));
    const handComputedRi = baseResolvedInputs({
      yarnComponents: [{ slot: 'Pile', rawMaterialId: 1, mixingPct: 100, pricePerKg: 220, dyeingCostPerKg: 0 }],
      processingChargeRatePerKg: 15, // old, explicitly not accepted
    });
    const [fromMixed, fromHandComputed] = await Promise.all([build(merged), build(handComputedRi)]);
    expect(fromMixed.breakup.ratePerKg.INR).toBeCloseTo(fromHandComputed.breakup.ratePerKg.INR, 10);
  });
});
