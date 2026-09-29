import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import type { CostingBreakup } from '../costing/engine';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.use(requireRole('SUPERVISOR', 'ADMIN'));

const LOST_STATUSES = ['LOST_PRICE', 'LOST_MOQ', 'LOST_LEAD_TIME'];

const quoteFull = {
  customer: { select: { id: true, name: true, region: true, currency: true } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    include: {
      segments: {
        include: {
          product: { select: { id: true, code: true, name: true } },
          items: { include: { itemType: true, hsnCode: true } },
        },
      },
    },
  },
} as const;

function parseBreakup(json: string | null): CostingBreakup | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function parseRollup(json: string | null): { ratePerSet: Record<string, number> } | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// INR value of 1 unit of `currency`, derived from a breakup's own ratePerKg (which always
// includes an INR entry) rather than looking up ExchangeRate history - this is the exact
// rate actually used to price that item at that moment, not an approximation.
function deriveFxRate(breakup: CostingBreakup, currency: string): number | null {
  if (currency === 'INR') return 1;
  const inr = breakup.ratePerKg?.INR;
  const foreign = breakup.ratePerKg?.[currency];
  if (!inr || !foreign) return null;
  return inr / foreign;
}

function lineTotal(line: { costBreakupJson: string | null }, currency: string): number {
  const rollup = parseRollup(line.costBreakupJson);
  return rollup?.ratePerSet?.[currency] ?? 0;
}

function quoteTotal(quote: { currency: string; lines: { costBreakupJson: string | null; qtySets: number }[] }): number {
  return quote.lines.reduce((sum, l) => sum + lineTotal(l, quote.currency) * l.qtySets, 0);
}

function dateRangeWhere(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = new Date(from);
  if (to) range.lte = new Date(to);
  return range;
}

// --- 1. Quote pipeline summary ---
reportsRouter.get('/pipeline-summary', async (req, res) => {
  const { from, to, customerId, merchandiserId } = req.query as Record<string, string | undefined>;
  const quotes = await prisma.quote.findMany({
    where: {
      createdAt: dateRangeWhere(from, to),
      customerId: customerId ? Number(customerId) : undefined,
      createdById: merchandiserId ? Number(merchandiserId) : undefined,
    },
    include: quoteFull,
  });

  const rows = new Map<string, { status: string; currency: string; count: number; totalValue: number }>();
  for (const q of quotes) {
    const key = `${q.status}|${q.currency}`;
    const row = rows.get(key) ?? { status: q.status, currency: q.currency, count: 0, totalValue: 0 };
    row.count += 1;
    row.totalValue += quoteTotal(q);
    rows.set(key, row);
  }
  res.json(Array.from(rows.values()));
});

// --- 2. Win/loss analysis ---
reportsRouter.get('/win-loss', async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const quotes = await prisma.quote.findMany({
    where: { status: { in: ['CONVERTED_TO_ORDER', ...LOST_STATUSES] }, updatedAt: dateRangeWhere(from, to) },
    include: quoteFull,
  });

  const rows = new Map<string, { status: string; currency: string; count: number; totalValue: number }>();
  for (const q of quotes) {
    const key = `${q.status}|${q.currency}`;
    const row = rows.get(key) ?? { status: q.status, currency: q.currency, count: 0, totalValue: 0 };
    row.count += 1;
    row.totalValue += quoteTotal(q);
    rows.set(key, row);
  }
  const total = quotes.length;
  res.json({ rows: Array.from(rows.values()), totalQuotes: total });
});

// --- 3. Sales by customer ---
reportsRouter.get('/sales-by-customer', async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const quotes = await prisma.quote.findMany({
    where: { status: { not: 'DRAFT' }, createdAt: dateRangeWhere(from, to) },
    include: quoteFull,
  });

  const rows = new Map<
    number,
    { customerId: number; customerName: string; region: string; currency: string; quoteCount: number; quotedValue: number; convertedCount: number; convertedValue: number }
  >();
  for (const q of quotes) {
    const row = rows.get(q.customerId) ?? {
      customerId: q.customerId,
      customerName: q.customer.name,
      region: q.customer.region,
      currency: q.currency,
      quoteCount: 0,
      quotedValue: 0,
      convertedCount: 0,
      convertedValue: 0,
    };
    row.quoteCount += 1;
    row.quotedValue += quoteTotal(q);
    if (q.status === 'CONVERTED_TO_ORDER') {
      row.convertedCount += 1;
      row.convertedValue += quoteTotal(q);
    }
    rows.set(q.customerId, row);
  }
  res.json(
    Array.from(rows.values())
      .map((r) => ({ ...r, winRate: r.quoteCount > 0 ? r.convertedCount / r.quoteCount : 0 }))
      .sort((a, b) => b.quotedValue - a.quotedValue),
  );
});

// --- 4. Sales by region/currency ---
reportsRouter.get('/sales-by-region', async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const quotes = await prisma.quote.findMany({
    where: { status: { not: 'DRAFT' }, createdAt: dateRangeWhere(from, to) },
    include: quoteFull,
  });

  const rows = new Map<string, { region: string; currency: string; count: number; quotedValue: number; convertedValue: number }>();
  for (const q of quotes) {
    const key = `${q.customer.region}|${q.currency}`;
    const row = rows.get(key) ?? { region: q.customer.region, currency: q.currency, count: 0, quotedValue: 0, convertedValue: 0 };
    row.count += 1;
    row.quotedValue += quoteTotal(q);
    if (q.status === 'CONVERTED_TO_ORDER') row.convertedValue += quoteTotal(q);
    rows.set(key, row);
  }
  res.json(Array.from(rows.values()).sort((a, b) => b.quotedValue - a.quotedValue));
});

// --- 5. Margin & profitability ---
reportsRouter.get('/margin-profitability', async (req, res) => {
  const groupBy = (req.query.groupBy as string) === 'product' ? 'product' : 'customer';
  const quotes = await prisma.quote.findMany({ where: { status: { not: 'DRAFT' } }, include: quoteFull });

  interface Agg {
    key: string;
    label: string;
    currency: string;
    itemCount: number;
    marginPctSum: number;
    effMarginPctSum: number;
    totalProfit: number;
  }
  const rows = new Map<string, Agg>();

  for (const q of quotes) {
    for (const line of q.lines) {
      for (const seg of line.segments) {
        const key = groupBy === 'product' ? String(seg.productId) : String(q.customerId);
        const label = groupBy === 'product' ? seg.product.name || seg.product.code : q.customer.name;
        for (const item of seg.items) {
          const b = parseBreakup(item.costBreakupJson);
          if (!b || b.marginPct == null) continue;
          const row = rows.get(key) ?? { key, label, currency: q.currency, itemCount: 0, marginPctSum: 0, effMarginPctSum: 0, totalProfit: 0 };
          row.itemCount += 1;
          row.marginPctSum += b.marginPct;
          row.effMarginPctSum += b.effectiveMarginPctInclDbk ?? b.marginPct;
          row.totalProfit += (b.profitInclDbk?.[q.currency] ?? 0) * item.qtyPerSet * line.qtySets;
          rows.set(key, row);
        }
      }
    }
  }

  res.json(
    Array.from(rows.values())
      .map((r) => ({
        label: r.label,
        currency: r.currency,
        itemCount: r.itemCount,
        avgMarginPct: r.itemCount ? r.marginPctSum / r.itemCount : 0,
        avgEffectiveMarginPctInclDbk: r.itemCount ? r.effMarginPctSum / r.itemCount : 0,
        totalProfit: r.totalProfit,
      }))
      .sort((a, b) => b.totalProfit - a.totalProfit),
  );
});

// --- 6. Price negotiation / erosion ---
reportsRouter.get('/price-erosion', async (req, res) => {
  const quotes = await prisma.quote.findMany({
    where: { revisions: { some: {} } },
    include: { ...quoteFull, revisions: { orderBy: { revisionNo: 'asc' }, take: 1 } },
  });

  const rows = quotes.map((q) => {
    const firstRev = q.revisions[0];
    const firstSnapshot: { lines: { lineId: number; ratePerSet: Record<string, number> | null }[] } = firstRev
      ? JSON.parse(firstRev.snapshotJson)
      : { lines: [] };
    const firstTotal = q.lines.reduce((sum, l) => {
      const snap = firstSnapshot.lines.find((s) => s.lineId === l.id);
      return sum + (snap?.ratePerSet?.[q.currency] ?? lineTotal(l, q.currency)) * l.qtySets;
    }, 0);
    const currentTotal = quoteTotal(q);
    return {
      quoteId: q.id,
      quoteNo: q.quoteNo,
      customerName: q.customer.name,
      currency: q.currency,
      status: q.status,
      locked: q.locked,
      firstQuotedValue: firstTotal,
      currentValue: currentTotal,
      dropPct: firstTotal > 0 ? (firstTotal - currentTotal) / firstTotal : 0,
    };
  });
  res.json(rows.sort((a, b) => b.dropPct - a.dropPct));
});

// --- 7. Duty Drawback (DBK) summary ---
reportsRouter.get('/dbk-summary', async (req, res) => {
  const quotes = await prisma.quote.findMany({ where: { status: { not: 'DRAFT' } }, include: quoteFull });

  const rows = new Map<string, { hsCode: string; description: string; currency: string; itemCount: number; totalIncentiveValue: number }>();
  for (const q of quotes) {
    for (const line of q.lines) {
      for (const seg of line.segments) {
        for (const item of seg.items) {
          if (!item.hsnCode) continue;
          const b = parseBreakup(item.costBreakupJson);
          if (!b || b.dbkProfitPerKgInr == null) continue;
          const fx = deriveFxRate(b, q.currency) ?? 1;
          const dbkPerPieceInCurrency = (b.dbkProfitPerKgInr / fx) * ((b.pieceWeightGrams ?? 0) / 1000);
          const value = dbkPerPieceInCurrency * item.qtyPerSet * line.qtySets;

          const key = `${item.hsnCode.hsCode}|${q.currency}`;
          const row = rows.get(key) ?? {
            hsCode: item.hsnCode.hsCode,
            description: item.hsnCode.description,
            currency: q.currency,
            itemCount: 0,
            totalIncentiveValue: 0,
          };
          row.itemCount += 1;
          row.totalIncentiveValue += value;
          rows.set(key, row);
        }
      }
    }
  }
  res.json(Array.from(rows.values()).sort((a, b) => b.totalIncentiveValue - a.totalIncentiveValue));
});

// --- 8. Locked quotes register ---
reportsRouter.get('/locked-register', async (_req, res) => {
  const quotes = await prisma.quote.findMany({
    where: { locked: true },
    include: { ...quoteFull, lockedBy: { select: { name: true } } },
    orderBy: { lockedAt: 'desc' },
  });
  res.json(
    quotes.map((q) => ({
      quoteId: q.id,
      finalReferenceNo: q.finalReferenceNo,
      quoteNo: q.quoteNo,
      customerName: q.customer.name,
      lockedBy: q.lockedBy?.name ?? '-',
      lockedAt: q.lockedAt,
      status: q.status,
      currency: q.currency,
      finalValue: quoteTotal(q),
    })),
  );
});

// --- 9. Approval turnaround ---
reportsRouter.get('/approval-turnaround', async (_req, res) => {
  const quotes = await prisma.quote.findMany({
    where: { submittedAt: { not: null }, approvedAt: { not: null } },
    include: quoteFull,
  });

  const rows = new Map<number, { merchandiserId: number; merchandiserName: string; count: number; totalHours: number }>();
  for (const q of quotes) {
    if (!q.submittedAt || !q.approvedAt) continue;
    const hours = (q.approvedAt.getTime() - q.submittedAt.getTime()) / 3600000;
    const row = rows.get(q.createdById) ?? { merchandiserId: q.createdById, merchandiserName: q.createdBy.name, count: 0, totalHours: 0 };
    row.count += 1;
    row.totalHours += hours;
    rows.set(q.createdById, row);
  }
  res.json(
    Array.from(rows.values())
      .map((r) => ({ merchandiserName: r.merchandiserName, count: r.count, avgTurnaroundHours: r.totalHours / r.count }))
      .sort((a, b) => a.avgTurnaroundHours - b.avgTurnaroundHours),
  );
});

// --- 10. Raw material rate history ---
reportsRouter.get('/raw-material-history', async (req, res) => {
  const rawMaterialId = req.query.rawMaterialId ? Number(req.query.rawMaterialId) : undefined;
  const rates = await prisma.rawMaterialRate.findMany({
    where: rawMaterialId ? { rawMaterialId } : undefined,
    include: { rawMaterial: { select: { code: true } }, enteredBy: { select: { name: true } }, approvedBy: { select: { name: true } } },
    orderBy: [{ rawMaterialId: 'asc' }, { validFrom: 'asc' }],
  });
  res.json(
    rates.map((r) => ({
      materialCode: r.rawMaterial.code,
      pricePerKg: r.pricePerKg,
      validFrom: r.validFrom,
      validTo: r.validTo,
      status: r.status,
      enteredBy: r.enteredBy.name,
      approvedBy: r.approvedBy?.name ?? '-',
    })),
  );
});

// --- 11. Master data export - handled client-side by reusing existing master endpoints ---

// --- 12. Pricing history for one product ---
reportsRouter.get('/pricing-history', async (req, res) => {
  const productId = Number(req.query.productId);
  if (!productId) return res.status(400).json({ error: 'productId is required' });

  const segments = await prisma.quoteLineSegment.findMany({
    where: { productId, quoteLine: { quote: { status: { not: 'DRAFT' } } } },
    include: {
      quoteLine: { include: { quote: { select: { quoteNo: true, currency: true, createdAt: true, customer: { select: { name: true } } } } } },
      items: { include: { itemType: true } },
    },
  });

  const rows: {
    date: Date;
    quoteNo: string;
    customerName: string;
    itemType: string;
    size: string;
    color: string;
    currency: string;
    ratePerPiece: number | null;
    ratePerKg: number | null;
    fxRate: number | null;
  }[] = [];

  for (const seg of segments) {
    const quote = seg.quoteLine.quote;
    for (const item of seg.items) {
      const b = parseBreakup(item.costBreakupJson);
      rows.push({
        date: quote.createdAt,
        quoteNo: quote.quoteNo,
        customerName: quote.customer.name,
        itemType: item.itemType.name,
        size: `${item.lengthCm}x${item.widthCm}`,
        color: seg.quoteLine.color,
        currency: quote.currency,
        ratePerPiece: b?.ratePerPiece?.[quote.currency] ?? null,
        ratePerKg: b?.ratePerKg?.[quote.currency] ?? null,
        fxRate: b ? deriveFxRate(b, quote.currency) : null,
      });
    }
  }
  res.json(rows.sort((a, b) => a.date.getTime() - b.date.getTime()));
});

// --- 13. Current pricing by customer ---
reportsRouter.get('/current-pricing-by-customer', async (req, res) => {
  const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
  const quotes = await prisma.quote.findMany({
    where: { status: { not: 'DRAFT' }, customerId },
    include: quoteFull,
    orderBy: { createdAt: 'asc' },
  });

  interface Row {
    customerName: string;
    productLabel: string;
    itemType: string;
    size: string;
    gsm: number;
    color: string;
    currency: string;
    ratePerPiece: number | null;
    ratePerKg: number | null;
    quoteNo: string;
    asOf: Date;
  }
  const latest = new Map<string, Row>();

  for (const q of quotes) {
    for (const line of q.lines) {
      for (const seg of line.segments) {
        for (const item of seg.items) {
          const key = `${q.customerId}|${seg.productId}|${item.itemTypeId}|${item.lengthCm}|${item.widthCm}|${item.gsm}|${line.color}`;
          const b = parseBreakup(item.costBreakupJson);
          latest.set(key, {
            customerName: q.customer.name,
            productLabel: seg.product.name || seg.product.code,
            itemType: item.itemType.name,
            size: `${item.lengthCm}x${item.widthCm}`,
            gsm: item.gsm,
            color: line.color,
            currency: q.currency,
            ratePerPiece: b?.ratePerPiece?.[q.currency] ?? null,
            ratePerKg: b?.ratePerKg?.[q.currency] ?? null,
            quoteNo: q.quoteNo,
            asOf: q.createdAt,
          });
        }
      }
    }
  }
  res.json(Array.from(latest.values()).sort((a, b) => a.customerName.localeCompare(b.customerName) || a.productLabel.localeCompare(b.productLabel)));
});
