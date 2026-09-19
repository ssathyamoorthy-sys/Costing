import { prisma } from './prisma';

export interface ResolvedRate {
  pricePerKg: number;
  rateId: number;
  isStale: boolean; // true if no rate is valid for "today" and we fell back to the last approved one
  validFrom: Date;
  validTo: Date | null;
}

/**
 * Resolve the raw material price to use right now: the currently-valid
 * approved rate, or - if none is valid today - the most recent approved rate
 * with a "stale" flag so callers can surface a warning (per product decision:
 * warn and continue with the previous price rather than blocking costing).
 */
export async function resolveCurrentRate(rawMaterialId: number, asOf: Date = new Date()): Promise<ResolvedRate | null> {
  const current = await prisma.rawMaterialRate.findFirst({
    where: {
      rawMaterialId,
      status: 'APPROVED',
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gte: asOf } }],
    },
    orderBy: { validFrom: 'desc' },
  });
  if (current) {
    return {
      pricePerKg: current.pricePerKg,
      rateId: current.id,
      isStale: false,
      validFrom: current.validFrom,
      validTo: current.validTo,
    };
  }

  const lastApproved = await prisma.rawMaterialRate.findFirst({
    where: { rawMaterialId, status: 'APPROVED' },
    orderBy: { validFrom: 'desc' },
  });
  if (!lastApproved) return null;

  return {
    pricePerKg: lastApproved.pricePerKg,
    rateId: lastApproved.id,
    isStale: true,
    validFrom: lastApproved.validFrom,
    validTo: lastApproved.validTo,
  };
}
