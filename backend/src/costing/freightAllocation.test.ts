import { describe, expect, it } from 'vitest';
import { computeFreightAllocation } from './freightAllocation';

const lines = [
  {
    qtySets: 10,
    segments: [
      {
        items: [
          { qtyKg: 0.5, pieceWeightGrams: 500 }, // 1 set = 0.5kg -> 10 sets = 5kg
          { qtyKg: 0.25, pieceWeightGrams: 250 }, // 10 sets = 2.5kg
        ],
      },
    ],
  },
  {
    qtySets: 5,
    segments: [{ items: [{ qtyKg: 1, pieceWeightGrams: 1000 }] }], // 5 sets = 5kg
  },
];
// grandTotalKg = 5 + 2.5 + 5 = 12.5kg

describe('computeFreightAllocation', () => {
  it('does not apply for FOB or unset incoterm, regardless of container cost', () => {
    const fob = computeFreightAllocation({ incoterm: 'FOB', containerCostTotal: 1250, freightTerms: null, lines });
    expect(fob.applies).toBe(false);
    expect(fob.perPiece(500)).toBe(0);

    const unset = computeFreightAllocation({ incoterm: null, containerCostTotal: 1250, freightTerms: null, lines });
    expect(unset.applies).toBe(false);
  });

  it('does not apply when no container cost is entered yet, even with a CIF incoterm', () => {
    const result = computeFreightAllocation({ incoterm: 'CIF', containerCostTotal: null, freightTerms: null, lines });
    expect(result.applies).toBe(false);
    expect(result.perPiece(500)).toBe(0);
  });

  it('allocates proportional to weight for CIF/CFR/Door Delivery', () => {
    const result = computeFreightAllocation({ incoterm: 'CIF', containerCostTotal: 1250, freightTerms: null, lines });
    expect(result.applies).toBe(true);
    expect(result.grandTotalKg).toBeCloseTo(12.5);
    expect(result.freightPerKg).toBeCloseTo(100); // 1250 / 12.5
    // A 500g piece: 100 * 0.5 = 50
    expect(result.perPiece(500)).toBeCloseTo(50);
    // A 1000g piece: 100 * 1 = 100
    expect(result.perPiece(1000)).toBeCloseTo(100);
    expect(result.perPiece(null)).toBe(0);
  });

  it('composes the terms label from the incoterm and supporting freight text', () => {
    const withText = computeFreightAllocation({ incoterm: 'CIF', containerCostTotal: 1250, freightTerms: 'Chennai Port, India', lines });
    expect(withText.termsLabel).toBe('CIF - Chennai Port, India');

    const withoutText = computeFreightAllocation({ incoterm: 'DOOR_DELIVERY', containerCostTotal: 1250, freightTerms: null, lines });
    expect(withoutText.termsLabel).toBe('Door Delivery');

    const unset = computeFreightAllocation({ incoterm: null, containerCostTotal: null, freightTerms: 'FOB Tuticorin', lines });
    expect(unset.termsLabel).toBeNull();
  });

  it('does not apply on an empty quote (zero weight)', () => {
    const result = computeFreightAllocation({ incoterm: 'CIF', containerCostTotal: 1250, freightTerms: null, lines: [] });
    expect(result.applies).toBe(false);
    expect(result.grandTotalKg).toBe(0);
  });
});
