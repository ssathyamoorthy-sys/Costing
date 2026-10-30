import type { Incoterm } from '../types';

// Mirrors backend/src/costing/freightAllocation.ts - see that file for the full rationale
// (container cost is a quote-wide rollup, computed fresh at render time rather than
// persisted into any line's pricing). Keep the two in sync if either changes.
export const ALLOCATED_INCOTERMS: Incoterm[] = ['CFR', 'CIF', 'DOOR_DELIVERY'];

export const INCOTERM_LABELS: Record<Incoterm, string> = {
  FOB: 'FOB',
  CFR: 'CFR',
  CIF: 'CIF',
  DOOR_DELIVERY: 'Door Delivery',
};

export interface FreightAllocationInput {
  incoterm?: Incoterm | null;
  containerCostTotal?: number | null;
  freightTerms?: string | null;
  lines: {
    qtySets: number;
    segments: { items: { qtyKg?: number | null; pieceWeightGrams?: number | null }[] }[];
  }[];
}

export interface FreightAllocationResult {
  applies: boolean;
  freightPerKg: number;
  grandTotalKg: number;
  perPiece(pieceWeightGrams: number | null | undefined): number;
  termsLabel: string | null;
}

export function computeFreightAllocation(input: FreightAllocationInput): FreightAllocationResult {
  const grandTotalKg = input.lines.reduce(
    (sum, line) =>
      sum +
      line.segments.reduce((segSum, seg) => segSum + seg.items.reduce((itemSum, item) => itemSum + (item.qtyKg ?? 0), 0), 0) * line.qtySets,
    0,
  );

  const incoterm = input.incoterm ?? null;
  const needsAllocation = !!incoterm && ALLOCATED_INCOTERMS.includes(incoterm);
  const hasCost = input.containerCostTotal != null && input.containerCostTotal > 0;
  const applies = needsAllocation && hasCost && grandTotalKg > 0;
  const freightPerKg = applies ? input.containerCostTotal! / grandTotalKg : 0;

  const termsLabel = incoterm ? `${INCOTERM_LABELS[incoterm] ?? incoterm}${input.freightTerms ? ` - ${input.freightTerms}` : ''}` : null;

  return {
    applies,
    freightPerKg,
    grandTotalKg,
    perPiece: (pieceWeightGrams) => (applies && pieceWeightGrams ? (freightPerKg * pieceWeightGrams) / 1000 : 0),
    termsLabel,
  };
}
