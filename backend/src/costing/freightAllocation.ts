// Container/shipping cost allocation for CFR/CIF/Door Delivery quotes - a quote-wide
// rollup, not a per-item cost input, so it's deliberately NOT part of computeSet()/
// costBreakupJson (see schema.prisma's comment on Quote.containerCostTotal for why: a
// single total has to be split across every Set in the quote, which computeSet() - called
// once per Set - has no visibility into). Instead this is derived fresh wherever a quote
// is rendered (PDF, both Excel exports, the quote page), the same way those renderers
// already compute their own grand totals (qty/kg/value) independently rather than
// persisting them anywhere.
export const ALLOCATED_INCOTERMS = ['CFR', 'CIF', 'DOOR_DELIVERY'] as const;
export type Incoterm = 'FOB' | (typeof ALLOCATED_INCOTERMS)[number];

export const INCOTERM_LABELS: Record<Incoterm, string> = {
  FOB: 'FOB',
  CFR: 'CFR',
  CIF: 'CIF',
  DOOR_DELIVERY: 'Door Delivery',
};

export interface FreightAllocationInput {
  incoterm: string | null;
  containerCostTotal: number | null;
  freightTerms: string | null;
  lines: {
    qtySets: number;
    segments: { items: { qtyKg: number | null; pieceWeightGrams: number | null }[] }[];
  }[];
}

export interface FreightAllocationResult {
  // True only when the incoterm requires allocation AND there's a positive cost and
  // weight to allocate it across - false (0 everywhere) for FOB/unset, for a container
  // cost not yet entered, or for an empty quote.
  applies: boolean;
  freightPerKg: number; // 0 when !applies, else containerCostTotal / grandTotalKg, in the quote's own currency
  grandTotalKg: number;
  // Freight add-on for one piece of the given weight - 0 when !applies.
  perPiece(pieceWeightGrams: number | null | undefined): number;
  // Composed "CIF - Chennai Port, India" (or just "CIF" with no supporting text) when an
  // incoterm is set; null when incoterm is unset, so callers fall back to the quote's
  // plain freightTerms text exactly as before this feature existed.
  termsLabel: string | null;
}

export function computeFreightAllocation(input: FreightAllocationInput): FreightAllocationResult {
  const grandTotalKg = input.lines.reduce(
    (sum, line) =>
      sum +
      line.segments.reduce((segSum, seg) => segSum + seg.items.reduce((itemSum, item) => itemSum + (item.qtyKg ?? 0), 0), 0) * line.qtySets,
    0,
  );

  const incoterm = input.incoterm as Incoterm | null;
  const needsAllocation = !!incoterm && (ALLOCATED_INCOTERMS as readonly string[]).includes(incoterm);
  const hasCost = input.containerCostTotal != null && input.containerCostTotal > 0;
  const applies = needsAllocation && hasCost && grandTotalKg > 0;
  const freightPerKg = applies ? input.containerCostTotal! / grandTotalKg : 0;

  const termsLabel = incoterm
    ? `${INCOTERM_LABELS[incoterm] ?? incoterm}${input.freightTerms ? ` - ${input.freightTerms}` : ''}`
    : null;

  return {
    applies,
    freightPerKg,
    grandTotalKg,
    perPiece: (pieceWeightGrams) => (applies && pieceWeightGrams ? (freightPerKg * pieceWeightGrams) / 1000 : 0),
    termsLabel,
  };
}
