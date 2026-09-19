import { prisma } from './prisma';

/** Latest exchange rate (INR value of 1 unit of currency) at or before `asOf`, for every currency on record. */
export async function getCurrentExchangeRates(asOf: Date = new Date()): Promise<Record<string, number>> {
  const rows = await prisma.exchangeRate.findMany({
    where: { validFrom: { lte: asOf } },
    orderBy: { validFrom: 'desc' },
  });
  const result: Record<string, number> = { INR: 1 };
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.currency)) continue;
    seen.add(row.currency);
    result[row.currency] = row.ratePerInr;
  }
  return result;
}
