import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { computeSet, type SegmentInput } from '../costing/computeSet';
import { resolveCurrentRate } from '../lib/rates';
import { notifyRole, notifyUser } from '../lib/notify';
import { generateQuotePdf } from '../pdf/quotePdf';
import { buildWorkbook } from '../xlsx/helpers';
import { buildDetailedQuoteWorkbook } from '../xlsx/buildDetailedQuoteWorkbook';
import { parseCostSheetWorkbook } from '../xlsx/importCostSheet';
import type { CostingBreakup } from '../costing/engine';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const quotesRouter = Router();
quotesRouter.use(requireAuth);

// Merchandisers see only the final rates, never the underlying cost build-up (yarn cost,
// weaving/velour/processing charges, margin, etc.) - those stay Supervisor/Admin-only.
// The Set's own costBreakupJson only ever holds { ratePerSet }, which is just the final
// combined price, so it's safe to leave as-is; only each Item's detailed breakup is stripped.
function sanitizeItemBreakup(costBreakupJson: string | null, role: string): string | null {
  if (role === 'SUPERVISOR' || role === 'ADMIN') return costBreakupJson;
  if (!costBreakupJson) return costBreakupJson;
  const full: CostingBreakup = JSON.parse(costBreakupJson);
  return JSON.stringify({ ratePerKg: full.ratePerKg, ratePerPiece: full.ratePerPiece });
}
function sanitizeLineForRole<T extends { segments: { items: { costBreakupJson: string | null }[] }[] }>(line: T, role: string): T {
  return {
    ...line,
    segments: line.segments.map((seg) => ({
      ...seg,
      items: seg.items.map((item) => ({ ...item, costBreakupJson: sanitizeItemBreakup(item.costBreakupJson, role) })),
    })),
  };
}
function sanitizeLinesForRole<T extends { segments: { items: { costBreakupJson: string | null }[] }[] }>(lines: T[], role: string): T[] {
  return lines.map((l) => sanitizeLineForRole(l, role));
}

// Recomputes every item in a quote line (Set) off current rates/overrides and writes the
// fresh cost breakup back to the DB. Shared by anything that changes a pricing input for
// an existing line: material overrides, and quote-level margin/commission/interest overrides.
async function recomputeLine(quoteLineId: number) {
  const line = await prisma.quoteLine.findUnique({ where: { id: quoteLineId } });
  if (!line) return;

  const allSegments = await prisma.quoteLineSegment.findMany({
    where: { quoteLineId },
    orderBy: { sortOrder: 'asc' },
    include: { yarnComponents: true, items: { include: { accessoryOverrides: true, packagingCharges: true } } },
  });

  const result = await computeSet({
    quoteId: line.quoteId,
    color: line.color,
    quoteLineId,
    segments: allSegments.map((s) => ({
      productId: s.productId,
      yarnComponents: s.yarnComponents.map((y) => ({ slot: y.slot, rawMaterialId: y.rawMaterialId, mixingPct: y.mixingPct })),
      items: s.items.map((it) => ({
        itemTypeId: it.itemTypeId,
        lengthCm: it.lengthCm,
        widthCm: it.widthCm,
        gsm: it.gsm,
        qtyPerSet: it.qtyPerSet,
        hsnCodeId: it.hsnCodeId,
        accessoryOverrides: it.accessoryOverrides.map((a) => ({ accessoryTypeId: a.accessoryTypeId, costPerPiece: a.costPerPiece })),
        packagingCharges: it.packagingCharges.map((p) => ({ description: p.description, ratePerPiece: p.ratePerPiece })),
      })),
    })),
  });

  for (let si = 0; si < allSegments.length; si++) {
    for (let ii = 0; ii < allSegments[si].items.length; ii++) {
      const computedItem = result.segments[si].items[ii];
      await prisma.quoteLineSegmentItem.update({
        where: { id: allSegments[si].items[ii].id },
        data: {
          pieceWeightGrams: computedItem.pieceWeightGrams,
          qtyKg: computedItem.qtyKg,
          costBreakupJson: JSON.stringify(computedItem.breakup),
        },
      });
    }
  }

  await prisma.quoteLine.update({
    where: { id: quoteLineId },
    data: { costBreakupJson: JSON.stringify({ ratePerSet: result.ratePerSet }) },
  });

  return result.warnings;
}

// Once locked, no price-mutating action is allowed for anyone except Admin (an emergency
// escape hatch) - the whole point of "Lock & Finalize" is that the negotiated price is
// irrevocable from here on.
async function assertNotLocked(quoteId: number, role: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, select: { locked: true } });
  if (!quote) return { ok: false, status: 404, error: 'Quote not found' };
  if (quote.locked && role !== 'ADMIN') {
    return { ok: false, status: 423, error: 'This quote is locked and finalized - pricing can no longer be changed' };
  }
  return { ok: true };
}

// Snapshots the quote's current pricing (every line's combined rate, plus the quote/line
// overrides driving it) right before a price-mutating action, but only once the customer
// has actually seen a price (APPROVED or SENT) - this is how negotiation rounds stay
// visible as history without needing a separate "start new round" step. A no-op on a
// DRAFT/PENDING_APPROVAL quote, since nothing has been quoted to the customer yet.
async function snapshotIfNeeded(quoteId: number, userId: number) {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: { lines: true } });
  if (!quote || quote.locked || !['APPROVED', 'SENT'].includes(quote.status)) return;

  const snapshot = {
    quote: {
      marginPctOverride: quote.marginPctOverride,
      commissionPctOverride: quote.commissionPctOverride,
      wcInterestPctOverride: quote.wcInterestPctOverride,
      lcInterestPctOverride: quote.lcInterestPctOverride,
      currency: quote.currency,
    },
    lines: quote.lines.map((l) => ({
      lineId: l.id,
      color: l.color,
      qtySets: l.qtySets,
      targetPrice: l.targetPrice,
      marginPctOverride: l.marginPctOverride,
      ratePerSet: l.costBreakupJson ? (JSON.parse(l.costBreakupJson).ratePerSet ?? null) : null,
    })),
  };

  const last = await prisma.quoteRevision.findFirst({ where: { quoteId }, orderBy: { revisionNo: 'desc' } });
  await prisma.quoteRevision.create({
    data: { quoteId, revisionNo: (last?.revisionNo ?? 0) + 1, snapshotJson: JSON.stringify(snapshot), createdById: userId },
  });
}

const lineFull = {
  segments: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      product: true,
      yarnComponents: { include: { rawMaterial: true } },
      materialOverrides: { include: { rawMaterial: true } },
      items: {
        include: {
          itemType: true,
          hsnCode: true,
          accessoryOverrides: { include: { accessoryType: true } },
          packagingCharges: true,
        },
      },
    },
  },
} as const;

quotesRouter.get('/', async (req, res) => {
  const mine = req.query.mine === 'true';
  const quotes = await prisma.quote.findMany({
    where: mine ? { createdById: req.user!.userId } : undefined,
    include: { customer: true, createdBy: { select: { name: true } }, lines: { include: lineFull } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(quotes.map((q) => ({ ...q, lines: sanitizeLinesForRole(q.lines, req.user!.role) })));
});

quotesRouter.get('/:id', async (req, res) => {
  const quote = await prisma.quote.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      customer: true,
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      lockedBy: { select: { name: true } },
      lines: { include: lineFull },
    },
  });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  res.json({ ...quote, lines: sanitizeLinesForRole(quote.lines, req.user!.role) });
});

quotesRouter.get('/:id/xlsx', async (req, res) => {
  const quote = await prisma.quote.findUnique({
    where: { id: Number(req.params.id) },
    include: { customer: true, lines: { include: lineFull } },
  });
  if (!quote) return res.status(404).json({ error: 'Not found' });

  const currency = quote.currency;
  const columns = [
    { header: 'Set #', key: 'setNo', width: 8 },
    { header: 'Item', key: 'item', width: 16 },
    { header: 'Quality', key: 'quality', width: 20 },
    { header: 'Length (cm)', key: 'length', width: 12 },
    { header: 'Width (cm)', key: 'width', width: 12 },
    { header: 'GSM', key: 'gsm', width: 8 },
    { header: 'Color', key: 'color', width: 14 },
    { header: 'Qty/Set', key: 'qtyPerSet', width: 10 },
    { header: `Rate/Pc (${currency})`, key: 'ratePc', width: 14, numFmt: '#,##0.0000' },
  ];

  const rows: Record<string, unknown>[] = [];
  quote.lines.forEach((line, li) => {
    const isSingle = line.segments.length === 1 && line.segments[0].items.length === 1;
    for (const seg of line.segments) {
      for (const item of seg.items) {
        const breakup: CostingBreakup | null = item.costBreakupJson ? JSON.parse(item.costBreakupJson) : null;
        rows.push({
          setNo: li + 1,
          item: item.itemType.name,
          quality: seg.product.name || seg.product.code,
          length: item.lengthCm,
          width: item.widthCm,
          gsm: item.gsm,
          color: line.color,
          qtyPerSet: isSingle ? `${line.qtySets} pcs` : item.qtyPerSet,
          ratePc: breakup?.ratePerPiece?.[currency] ?? '',
        });
      }
    }
    // A single-item set's own row above already is the "combined" rate - no need for a
    // second summary row repeating the same number.
    if (!isSingle) {
      const setRollup: { ratePerSet: Record<string, number> } | null = line.costBreakupJson ? JSON.parse(line.costBreakupJson) : null;
      rows.push({
        item: `Combined rate / set (Set #${li + 1})`,
        ratePc: setRollup?.ratePerSet?.[currency] ?? '',
        qtyPerSet: `${line.qtySets} sets ordered`,
      });
    }
    rows.push({});
  });

  const wb = buildWorkbook([{ name: 'Price List', columns, rows }]);
  const ws = wb.getWorksheet('Price List')!;
  ws.spliceRows(1, 0, [`Quote ${quote.quoteNo} - ${quote.customer.name} - ${quote.createdAt.toDateString()}`]);
  ws.spliceRows(2, 0, []);
  ws.getRow(1).font = { bold: true, size: 13 };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${quote.quoteNo}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

quotesRouter.get('/:id/pdf', async (req, res) => {
  const quote = await prisma.quote.findUnique({
    where: { id: Number(req.params.id) },
    include: { customer: true, lines: { include: lineFull } },
  });
  if (!quote) return res.status(404).json({ error: 'Not found' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${quote.quoteNo}.pdf"`);
  const doc = generateQuotePdf(quote);
  doc.pipe(res);
  doc.end();
});

// Supervisor/Admin only: the full cost build-up as live Excel formulas, one sheet per
// item (mirrors "Price Working.xlsx") - this is the one export that exposes the
// underlying cost stack, so it stays out of the Merchandiser-facing PDF/summary xlsx.
quotesRouter.get('/:id/xlsx-detailed', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quote = await prisma.quote.findUnique({ where: { id: Number(req.params.id) }, select: { quoteNo: true } });
  if (!quote) return res.status(404).json({ error: 'Not found' });

  const wb = await buildDetailedQuoteWorkbook(Number(req.params.id));
  if (!wb) return res.status(404).json({ error: 'Not found' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${quote.quoteNo}-detailed.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// Supervisor/Admin: re-upload a previously downloaded "Download Excel (with formulas)"
// cost sheet after editing it, applying any changed yarn prices, per-Set margin, and
// (if consistent across every sheet) quote-wide commission/WC/LC interest. Everything else
// in the sheet - the BOM chain, cost stack, final price formulas - is read-only and
// ignored; the server always recomputes the price fresh through the normal costing engine,
// so an edited formula cell or a reordered row can never feed a stale number back in.
quotesRouter.post('/:id/import-costsheet', requireRole('SUPERVISOR', 'ADMIN'), upload.single('file'), async (req, res) => {
  const quoteId = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: { customer: true, lines: { include: lineFull } } });
  if (!quote) return res.status(404).json({ error: 'Not found' });

  const lockCheck = await assertNotLocked(quoteId, req.user!.role);
  if (!lockCheck.ok) return res.status(lockCheck.status).json({ error: lockCheck.error });

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(req.file.buffer as any);
  } catch {
    return res.status(400).json({ error: 'Could not read this file as an Excel workbook' });
  }
  const parsedSheets = parseCostSheetWorkbook(wb);

  const warnings: string[] = [];
  const materialChanges: { segmentId: number; rawMaterialId: number; materialCode: string; price: number; sheetName: string }[] = [];
  const marginChanges = new Map<number, number>(); // lineId -> new marginPctOverride
  const commissionValues = new Set<number>();
  const wcValues = new Set<number>();
  const lcValues = new Set<number>();
  const affectedLineIds = new Set<number>();

  for (const sheet of parsedSheets) {
    if (sheet.quoteNoInSheet && sheet.quoteNoInSheet !== quote.quoteNo) {
      warnings.push(`Sheet "${sheet.sheetName}": belongs to quote ${sheet.quoteNoInSheet}, not this one (${quote.quoteNo}) - skipped.`);
      continue;
    }
    if (!sheet.setNo || sheet.setNo < 1 || sheet.setNo > quote.lines.length) {
      warnings.push(`Sheet "${sheet.sheetName}": can't tell which Set this belongs to - skipped.`);
      continue;
    }
    const line = quote.lines[sheet.setNo - 1];

    const candidates = line.segments.flatMap((seg) => seg.items.map((item) => ({ seg, item })));
    let matched = candidates.find(
      ({ item }) =>
        item.itemType.name === sheet.itemTypeNameFromSheetName &&
        item.lengthCm === sheet.lengthCm &&
        item.widthCm === sheet.widthCm &&
        item.gsm === sheet.gsm,
    );
    if (!matched) {
      matched = candidates.find(({ item }) => item.itemType.name === sheet.itemTypeNameFromSheetName);
      if (matched) warnings.push(`Sheet "${sheet.sheetName}": size doesn't match this item anymore - prices applied anyway, size left as-is.`);
    }
    if (!matched) {
      warnings.push(`Sheet "${sheet.sheetName}": couldn't match this to an item in Set #${sheet.setNo} - skipped.`);
      continue;
    }
    const { seg } = matched;
    affectedLineIds.add(line.id);

    for (const yarnRow of sheet.yarnRows) {
      const component = seg.yarnComponents.find((c) => c.rawMaterial.code === yarnRow.materialCode);
      if (!component) {
        warnings.push(`Sheet "${sheet.sheetName}": material "${yarnRow.materialCode}" isn't part of this segment's recipe - ignored.`);
        continue;
      }
      const existingOverride = seg.materialOverrides.find((o) => o.rawMaterialId === component.rawMaterialId);
      const masterRate = existingOverride ? null : await resolveCurrentRate(component.rawMaterialId);
      const currentEffective = existingOverride?.overridePricePerKg ?? masterRate?.pricePerKg ?? null;
      if (currentEffective == null || Math.abs(currentEffective - yarnRow.pricePerKg) > 0.0001) {
        materialChanges.push({ segmentId: seg.id, rawMaterialId: component.rawMaterialId, materialCode: yarnRow.materialCode, price: yarnRow.pricePerKg, sheetName: sheet.sheetName });
      }
    }

    if (sheet.marginPct != null) {
      const currentMargin = line.marginPctOverride ?? quote.marginPctOverride ?? quote.customer.marginPct;
      if (Math.abs(currentMargin - sheet.marginPct) > 0.0001) marginChanges.set(line.id, sheet.marginPct);
    }
    if (sheet.commissionPct != null) commissionValues.add(Math.round(sheet.commissionPct * 1e6) / 1e6);
    if (sheet.wcInterestPct != null) wcValues.add(Math.round(sheet.wcInterestPct * 1e6) / 1e6);
    if (sheet.lcInterestPct != null) lcValues.add(Math.round(sheet.lcInterestPct * 1e6) / 1e6);
  }

  const quoteUpdate: { commissionPctOverride?: number; wcInterestPctOverride?: number; lcInterestPctOverride?: number } = {};
  const currentCommission = quote.commissionPctOverride ?? quote.customer.commissionPct;
  const currentWc = quote.wcInterestPctOverride ?? quote.customer.wcInterestPct;
  const currentLc = quote.lcInterestPctOverride ?? quote.customer.lcInterestPct;
  if (commissionValues.size === 1) {
    const [v] = commissionValues;
    if (Math.abs(currentCommission - v) > 0.0001) quoteUpdate.commissionPctOverride = v;
  } else if (commissionValues.size > 1) {
    warnings.push('Commission % differs across sheets - left unchanged. Edit it from the Commercial terms panel instead.');
  }
  if (wcValues.size === 1) {
    const [v] = wcValues;
    if (Math.abs(currentWc - v) > 0.0001) quoteUpdate.wcInterestPctOverride = v;
  } else if (wcValues.size > 1) {
    warnings.push('W.C. Interest % differs across sheets - left unchanged.');
  }
  if (lcValues.size === 1) {
    const [v] = lcValues;
    if (Math.abs(currentLc - v) > 0.0001) quoteUpdate.lcInterestPctOverride = v;
  } else if (lcValues.size > 1) {
    warnings.push('LC Interest % differs across sheets - left unchanged.');
  }

  if (materialChanges.length === 0 && marginChanges.size === 0 && Object.keys(quoteUpdate).length === 0) {
    return res.json({ changed: false, warnings: warnings.length ? warnings : ['Nothing in this file differs from the current quote.'] });
  }

  await snapshotIfNeeded(quoteId, req.user!.userId);

  for (const change of materialChanges) {
    const existing = await prisma.quoteLineSegmentMaterialOverride.findFirst({
      where: { segmentId: change.segmentId, rawMaterialId: change.rawMaterialId },
    });
    if (existing) {
      await prisma.quoteLineSegmentMaterialOverride.update({
        where: { id: existing.id },
        data: { overridePricePerKg: change.price, reason: 'Updated via Excel cost sheet re-upload', setById: req.user!.userId },
      });
    } else {
      await prisma.quoteLineSegmentMaterialOverride.create({
        data: {
          segmentId: change.segmentId,
          rawMaterialId: change.rawMaterialId,
          overridePricePerKg: change.price,
          reason: 'Updated via Excel cost sheet re-upload',
          setById: req.user!.userId,
        },
      });
    }
  }
  for (const [lineId, marginPct] of marginChanges) {
    await prisma.quoteLine.update({ where: { id: lineId }, data: { marginPctOverride: marginPct } });
  }
  if (Object.keys(quoteUpdate).length > 0) {
    await prisma.quote.update({ where: { id: quoteId }, data: quoteUpdate });
  }

  const recomputeWarnings: string[] = [];
  for (const lineId of affectedLineIds) {
    const w = await recomputeLine(lineId);
    if (w) recomputeWarnings.push(...w);
  }

  res.json({
    changed: true,
    materialsUpdated: materialChanges.length,
    marginsUpdated: marginChanges.size,
    commercialTermsUpdated: Object.keys(quoteUpdate),
    warnings: [...warnings, ...recomputeWarnings],
  });
});

// Supervisor/Admin only: permanently remove a quote (cascades to its lines/segments/items).
quotesRouter.delete('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quote = await prisma.quote.findUnique({ where: { id: Number(req.params.id) } });
  if (!quote) return res.status(404).json({ error: 'Not found' });

  await prisma.quote.delete({ where: { id: quote.id } });
  res.status(204).send();
});

const createQuoteSchema = z.object({
  customerId: z.number().int().positive(),
  validityDate: z.string().optional(),
});

quotesRouter.post('/', requireRole('MERCHANDISER', 'ADMIN'), async (req, res) => {
  const parsed = createQuoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const customer = await prisma.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const quoteNo = `DRAFT-${Date.now()}`;
  const quote = await prisma.quote.create({
    data: {
      quoteNo,
      customerId: parsed.data.customerId,
      createdById: req.user!.userId,
      // Domestic (India) customers are always billed in INR, enforced on the Customer record
      // itself (see customers.ts) - so this is simply the customer's currency, whatever it is.
      currency: customer.currency,
      validityDate: parsed.data.validityDate ? new Date(parsed.data.validityDate) : undefined,
      paymentTerms: customer.paymentTerms,
      freightTerms: customer.freightTerms,
    },
  });
  res.status(201).json(quote);
});

const itemAccessoryOverrideSchema = z.object({ accessoryTypeId: z.number().int().positive(), costPerPiece: z.number().nonnegative() });
const itemPackagingChargeSchema = z.object({ description: z.string().min(1), ratePerPiece: z.number().nonnegative() });

const itemSchema = z.object({
  itemTypeId: z.number().int().positive(),
  lengthCm: z.number().positive(),
  widthCm: z.number().positive(),
  gsm: z.number().positive(),
  qtyPerSet: z.number().int().positive(),
  hsnCodeId: z.number().int().positive().nullable().optional(),
  accessoryOverrides: z.array(itemAccessoryOverrideSchema).optional(),
  packagingCharges: z.array(itemPackagingChargeSchema).optional(),
});

const segmentYarnSchema = z.object({
  slot: z.string().min(1),
  rawMaterialId: z.number().int().positive(),
  mixingPct: z.number().positive(),
});

const segmentSchema = z.object({
  productId: z.number().int().positive(),
  yarnComponents: z.array(segmentYarnSchema).min(1),
  items: z.array(itemSchema).min(1),
});

const lineSchema = z.object({
  color: z.string().min(1),
  qtySets: z.number().int().positive(),
  targetPrice: z.number().optional(),
  segments: z.array(segmentSchema).min(1),
});

type EditableCheck =
  | { ok: true; quote: NonNullable<Awaited<ReturnType<typeof prisma.quote.findUnique>>> }
  | { ok: false; error: string; status: number };

async function assertEditableByOwner(quoteId: number, userId: number, roleAdminOk: boolean): Promise<EditableCheck> {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return { ok: false, error: 'Quote not found', status: 404 };
  if (quote.status !== 'DRAFT' && !roleAdminOk) {
    return { ok: false, error: `Quote is ${quote.status}, cannot be edited by the merchandiser anymore`, status: 409 };
  }
  if (quote.createdById !== userId && !roleAdminOk) {
    return { ok: false, error: 'Not your quote', status: 403 };
  }
  return { ok: true, quote };
}

function buildSegmentsCreateInput(segments: Awaited<ReturnType<typeof computeSet>>['segments']) {
  return segments.map((seg, i) => ({
    productId: seg.productId,
    sortOrder: i,
    yarnComponents: { create: seg.yarnComponents },
    items: {
      create: seg.items.map((item) => ({
        itemTypeId: item.itemTypeId,
        lengthCm: item.lengthCm,
        widthCm: item.widthCm,
        gsm: item.gsm,
        qtyPerSet: item.qtyPerSet,
        hsnCodeId: item.hsnCodeId ?? undefined,
        pieceWeightGrams: item.pieceWeightGrams,
        qtyKg: item.qtyKg,
        costBreakupJson: JSON.stringify(item.breakup),
        accessoryOverrides: item.accessoryOverrides?.length ? { create: item.accessoryOverrides } : undefined,
        packagingCharges: item.packagingCharges?.length ? { create: item.packagingCharges } : undefined,
      })),
    },
  }));
}

quotesRouter.post('/:id/lines', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const isSupervisor = req.user!.role === 'SUPERVISOR' || req.user!.role === 'ADMIN';
  const check = await assertEditableByOwner(quoteId, req.user!.userId, isSupervisor);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const lockCheck = await assertNotLocked(quoteId, req.user!.role);
  if (!lockCheck.ok) return res.status(lockCheck.status).json({ error: lockCheck.error });

  const parsed = lineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await computeSet({ quoteId, color: parsed.data.color, segments: parsed.data.segments as SegmentInput[] });

    const line = await prisma.quoteLine.create({
      data: {
        quoteId,
        color: parsed.data.color,
        qtySets: parsed.data.qtySets,
        targetPrice: parsed.data.targetPrice,
        costBreakupJson: JSON.stringify({ ratePerSet: result.ratePerSet }),
        segments: { create: buildSegmentsCreateInput(result.segments) },
      },
      include: lineFull,
    });

    res.status(201).json({ line: sanitizeLineForRole(line, req.user!.role), warnings: result.warnings });
  } catch (err: any) {
    res.status(422).json({ error: err.message });
  }
});

quotesRouter.put('/:id/lines/:lineId', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const isSupervisor = req.user!.role === 'SUPERVISOR' || req.user!.role === 'ADMIN';
  const check = await assertEditableByOwner(quoteId, req.user!.userId, isSupervisor);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const lockCheck = await assertNotLocked(quoteId, req.user!.role);
  if (!lockCheck.ok) return res.status(lockCheck.status).json({ error: lockCheck.error });

  const parsed = lineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.quoteLine.findUnique({ where: { id: lineId } });
  if (!existing || existing.quoteId !== quoteId) return res.status(404).json({ error: 'Line not found' });

  await snapshotIfNeeded(quoteId, req.user!.userId);

  try {
    // Compute against the OLD segments still on file, so segment-level material overrides
    // already set by a supervisor carry over to the edited set.
    const result = await computeSet({
      quoteId,
      color: parsed.data.color,
      segments: parsed.data.segments as SegmentInput[],
      quoteLineId: lineId,
    });

    await prisma.quoteLineSegment.deleteMany({ where: { quoteLineId: lineId } });

    const line = await prisma.quoteLine.update({
      where: { id: lineId },
      data: {
        color: parsed.data.color,
        qtySets: parsed.data.qtySets,
        targetPrice: parsed.data.targetPrice,
        costBreakupJson: JSON.stringify({ ratePerSet: result.ratePerSet }),
        segments: { create: buildSegmentsCreateInput(result.segments) },
      },
      include: lineFull,
    });

    res.json({ line: sanitizeLineForRole(line, req.user!.role), warnings: result.warnings });
  } catch (err: any) {
    res.status(422).json({ error: err.message });
  }
});

quotesRouter.delete('/:id/lines/:lineId', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const isSupervisor = req.user!.role === 'SUPERVISOR' || req.user!.role === 'ADMIN';
  const check = await assertEditableByOwner(quoteId, req.user!.userId, isSupervisor);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const lockCheck = await assertNotLocked(quoteId, req.user!.role);
  if (!lockCheck.ok) return res.status(lockCheck.status).json({ error: lockCheck.error });

  await snapshotIfNeeded(quoteId, req.user!.userId);

  await prisma.quoteLine.delete({ where: { id: Number(req.params.lineId) } });
  res.status(204).send();
});

// Saves this line's segments/yarn/items/accessories/packaging as a named, reusable
// template tied to the quote's customer - no pricing is copied, since applying the
// template later recomputes it fresh off current rates and customer terms.
const saveAsTemplateSchema = z.object({ name: z.string().min(1) });

type LineWithSegmentsForTemplate = {
  color: string;
  qtySets: number;
  segments: {
    productId: number;
    sortOrder: number;
    yarnComponents: { slot: string; rawMaterialId: number; mixingPct: number }[];
    items: {
      itemTypeId: number;
      lengthCm: number;
      widthCm: number;
      gsm: number;
      qtyPerSet: number;
      accessoryOverrides: { accessoryTypeId: number; costPerPiece: number }[];
      packagingCharges: { description: string; ratePerPiece: number }[];
    }[];
  }[];
};

async function createTemplateFromLine(line: LineWithSegmentsForTemplate, customerId: number, name: string, createdById: number) {
  return prisma.quoteTemplate.create({
    data: {
      customerId,
      name,
      color: line.color,
      qtySets: line.qtySets,
      createdById,
      segments: {
        create: line.segments.map((seg, i) => ({
          productId: seg.productId,
          sortOrder: i,
          yarnComponents: { create: seg.yarnComponents.map((y) => ({ slot: y.slot, rawMaterialId: y.rawMaterialId, mixingPct: y.mixingPct })) },
          items: {
            create: seg.items.map((item) => ({
              itemTypeId: item.itemTypeId,
              lengthCm: item.lengthCm,
              widthCm: item.widthCm,
              gsm: item.gsm,
              qtyPerSet: item.qtyPerSet,
              accessoryOverrides: item.accessoryOverrides.length
                ? { create: item.accessoryOverrides.map((a) => ({ accessoryTypeId: a.accessoryTypeId, costPerPiece: a.costPerPiece })) }
                : undefined,
              packagingCharges: item.packagingCharges.length
                ? { create: item.packagingCharges.map((p) => ({ description: p.description, ratePerPiece: p.ratePerPiece })) }
                : undefined,
            })),
          },
        })),
      },
    },
  });
}

quotesRouter.post('/:id/lines/:lineId/save-as-template', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = saveAsTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const lineId = Number(req.params.lineId);
  const line = await prisma.quoteLine.findUnique({
    where: { id: lineId },
    include: {
      quote: { select: { customerId: true } },
      segments: {
        orderBy: { sortOrder: 'asc' },
        include: {
          yarnComponents: true,
          items: { include: { accessoryOverrides: true, packagingCharges: true } },
        },
      },
    },
  });
  if (!line || line.quoteId !== Number(req.params.id)) return res.status(404).json({ error: 'Line not found' });

  const existing = await prisma.quoteTemplate.findFirst({ where: { customerId: line.quote.customerId, name: parsed.data.name } });
  if (existing) return res.status(409).json({ error: `A template named "${parsed.data.name}" already exists for this customer` });

  const template = await createTemplateFromLine(line, line.quote.customerId, parsed.data.name, req.user!.userId);

  res.status(201).json(template);
});

// Saves every current line in this quote as a named, reusable group of templates (one
// underlying QuoteTemplate per Set, auto-named "<group name> - Set N") - a repeat order's
// whole recipe, not just one Set. Applying the group later re-creates every line fresh,
// same as applying a single template.
const saveAsTemplateGroupSchema = z.object({ name: z.string().min(1) });

quotesRouter.post('/:id/save-as-template-group', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = saveAsTemplateGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const quote = await prisma.quote.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      lines: {
        include: {
          segments: {
            orderBy: { sortOrder: 'asc' },
            include: {
              yarnComponents: true,
              items: { include: { accessoryOverrides: true, packagingCharges: true } },
            },
          },
        },
      },
    },
  });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  if (quote.lines.length === 0) return res.status(400).json({ error: 'This quote has no sets to save yet' });

  const existingGroup = await prisma.quoteTemplateGroup.findFirst({ where: { customerId: quote.customerId, name: parsed.data.name } });
  if (existingGroup) return res.status(409).json({ error: `A template group named "${parsed.data.name}" already exists for this customer` });

  const memberTemplates = [];
  for (let i = 0; i < quote.lines.length; i++) {
    const template = await createTemplateFromLine(quote.lines[i], quote.customerId, `${parsed.data.name} - Set ${i + 1}`, req.user!.userId);
    memberTemplates.push(template);
  }

  const group = await prisma.quoteTemplateGroup.create({
    data: {
      customerId: quote.customerId,
      name: parsed.data.name,
      createdById: req.user!.userId,
      members: { create: memberTemplates.map((t, i) => ({ templateId: t.id, sortOrder: i })) },
    },
  });

  res.status(201).json(group);
});

// Supervisor: override one raw material's price for a specific quote-line SEGMENT
// (one-off, notifies Purchase). All items in that segment recost off the new price,
// and the Set's combined rate is recomputed too.
const overrideSchema = z.object({ rawMaterialId: z.number().int().positive(), overridePricePerKg: z.number().positive(), reason: z.string().optional() });

quotesRouter.post('/:id/segments/:segmentId/material-override', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const segmentId = Number(req.params.segmentId);
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const segment = await prisma.quoteLineSegment.findUnique({
    where: { id: segmentId },
    include: { quoteLine: { include: { quote: true } } },
  });
  if (!segment) return res.status(404).json({ error: 'Segment not found' });

  const lockCheck = await assertNotLocked(segment.quoteLine.quoteId, req.user!.role);
  if (!lockCheck.ok) return res.status(lockCheck.status).json({ error: lockCheck.error });

  const material = await prisma.rawMaterial.findUnique({ where: { id: parsed.data.rawMaterialId } });
  if (!material) return res.status(404).json({ error: 'Raw material not found' });

  await snapshotIfNeeded(segment.quoteLine.quoteId, req.user!.userId);

  const existingOverride = await prisma.quoteLineSegmentMaterialOverride.findFirst({
    where: { segmentId, rawMaterialId: parsed.data.rawMaterialId },
  });
  if (existingOverride) {
    await prisma.quoteLineSegmentMaterialOverride.update({
      where: { id: existingOverride.id },
      data: { overridePricePerKg: parsed.data.overridePricePerKg, reason: parsed.data.reason, setById: req.user!.userId },
    });
  } else {
    await prisma.quoteLineSegmentMaterialOverride.create({
      data: {
        segmentId,
        rawMaterialId: parsed.data.rawMaterialId,
        overridePricePerKg: parsed.data.overridePricePerKg,
        reason: parsed.data.reason,
        setById: req.user!.userId,
      },
    });
  }

  await notifyRole(
    'PURCHASE',
    'Price override used on a quote',
    `Quote #${segment.quoteLine.quote.quoteNo}: supervisor overrode "${material.code}" to Rs.${parsed.data.overridePricePerKg}/kg for this quote only.${parsed.data.reason ? ` Reason: ${parsed.data.reason}` : ''}`,
  );

  // Recompute the whole Set - the override affects every item in this segment, and the
  // combined set rate depends on every segment.
  const quoteLineId = segment.quoteLine.id;
  const warnings = await recomputeLine(quoteLineId);

  const updatedLine = await prisma.quoteLine.findUniqueOrThrow({ where: { id: quoteLineId }, include: lineFull });

  res.json({ line: sanitizeLineForRole(updatedLine, req.user!.role), warnings });
});

// Supervisor: override the customer's margin/commission/WC-interest/LC-interest terms for
// this quote only (never touches the Customer record). Passing null for a field clears that
// override back to the customer's standard value. Every line in the quote is recosted.
const termsOverrideSchema = z.object({
  marginPctOverride: z.number().nullable().optional(),
  commissionPctOverride: z.number().nullable().optional(),
  wcInterestPctOverride: z.number().nullable().optional(),
  lcInterestPctOverride: z.number().nullable().optional(),
});

quotesRouter.post('/:id/terms-override', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const parsed = termsOverrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: { lines: true } });
  if (!quote) return res.status(404).json({ error: 'Not found' });

  const lockCheck = await assertNotLocked(quoteId, req.user!.role);
  if (!lockCheck.ok) return res.status(lockCheck.status).json({ error: lockCheck.error });

  await snapshotIfNeeded(quoteId, req.user!.userId);

  await prisma.quote.update({ where: { id: quoteId }, data: parsed.data });

  const warnings: string[] = [];
  for (const line of quote.lines) {
    const lineWarnings = await recomputeLine(line.id);
    if (lineWarnings) warnings.push(...lineWarnings);
  }

  const updated = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { customer: true, createdBy: { select: { name: true } }, approvedBy: { select: { name: true } }, lines: { include: lineFull } },
  });

  res.json({ ...updated, lines: sanitizeLinesForRole(updated.lines, req.user!.role), warnings });
});

// Supervisor: set this Set's own margin override so its combined price exactly hits the
// merchandiser's target price - only this Set's price moves, nothing else in the quote.
//
// Combined price scales as C / (1 - (margin + commission)) for a fixed C (everything else
// in the cost stack held constant), so given the CURRENT combined price and CURRENT
// effective margin, C = currentTotal * (1 - (currentMargin + commission)), and solving for
// the margin that makes the combined price equal targetPrice:
//   requiredMargin = 1 - commission - C / targetPrice
quotesRouter.post('/:id/lines/:lineId/match-target-price', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const lineId = Number(req.params.lineId);

  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: { customer: true } });
  if (!quote) return res.status(404).json({ error: 'Not found' });

  const line = await prisma.quoteLine.findUnique({ where: { id: lineId } });
  if (!line || line.quoteId !== quoteId) return res.status(404).json({ error: 'Line not found' });
  if (!line.targetPrice || line.targetPrice <= 0) return res.status(422).json({ error: 'This set has no target price set' });

  const lockCheck = await assertNotLocked(quoteId, req.user!.role);
  if (!lockCheck.ok) return res.status(lockCheck.status).json({ error: lockCheck.error });

  await snapshotIfNeeded(quoteId, req.user!.userId);

  const setRollup: { ratePerSet: Record<string, number> } | null = line.costBreakupJson ? JSON.parse(line.costBreakupJson) : null;
  const currentTotal = setRollup?.ratePerSet?.[quote.currency];
  if (currentTotal == null) return res.status(422).json({ error: 'This set has not been priced yet' });

  const commission = quote.commissionPctOverride ?? quote.customer.commissionPct;
  const currentMargin = line.marginPctOverride ?? quote.marginPctOverride ?? quote.customer.marginPct;

  const c = currentTotal * (1 - (currentMargin + commission));
  const requiredMargin = 1 - commission - c / line.targetPrice;

  await prisma.quoteLine.update({ where: { id: lineId }, data: { marginPctOverride: requiredMargin } });
  const warnings = await recomputeLine(lineId);

  const updatedLine = await prisma.quoteLine.findUniqueOrThrow({ where: { id: lineId }, include: lineFull });
  res.json({ line: sanitizeLineForRole(updatedLine, req.user!.role), marginPctOverride: requiredMargin, warnings });
});

// Supervisor: set this Set's margin directly, without needing a target price first - the
// straightforward "just tell me the margin" counterpart to match-target-price above.
const marginOverrideSchema = z.object({ marginPctOverride: z.number() });

quotesRouter.post('/:id/lines/:lineId/margin-override', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const parsed = marginOverrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const line = await prisma.quoteLine.findUnique({ where: { id: lineId } });
  if (!line || line.quoteId !== quoteId) return res.status(404).json({ error: 'Line not found' });

  const lockCheck = await assertNotLocked(quoteId, req.user!.role);
  if (!lockCheck.ok) return res.status(lockCheck.status).json({ error: lockCheck.error });

  await snapshotIfNeeded(quoteId, req.user!.userId);

  await prisma.quoteLine.update({ where: { id: lineId }, data: { marginPctOverride: parsed.data.marginPctOverride } });
  const warnings = await recomputeLine(lineId);

  const updatedLine = await prisma.quoteLine.findUniqueOrThrow({ where: { id: lineId }, include: lineFull });
  res.json({ line: sanitizeLineForRole(updatedLine, req.user!.role), warnings });
});

quotesRouter.post('/:id/lines/:lineId/clear-margin-override', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const line = await prisma.quoteLine.findUnique({ where: { id: lineId } });
  if (!line || line.quoteId !== quoteId) return res.status(404).json({ error: 'Line not found' });

  const lockCheck = await assertNotLocked(quoteId, req.user!.role);
  if (!lockCheck.ok) return res.status(lockCheck.status).json({ error: lockCheck.error });

  await snapshotIfNeeded(quoteId, req.user!.userId);

  await prisma.quoteLine.update({ where: { id: lineId }, data: { marginPctOverride: null } });
  const warnings = await recomputeLine(lineId);

  const updatedLine = await prisma.quoteLine.findUniqueOrThrow({ where: { id: lineId }, include: lineFull });
  res.json({ line: sanitizeLineForRole(updatedLine, req.user!.role), warnings });
});

// --- Workflow ---

quotesRouter.post('/:id/submit', requireRole('MERCHANDISER', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: { lines: true } });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  if (quote.createdById !== req.user!.userId) return res.status(403).json({ error: 'Not your quote' });
  if (quote.status !== 'DRAFT') return res.status(409).json({ error: `Quote is already ${quote.status}` });
  if (quote.lines.length === 0) return res.status(422).json({ error: 'Add at least one line before submitting' });

  const updated = await prisma.quote.update({ where: { id: quoteId }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
  await notifyRole('SUPERVISOR', 'Quote pending approval', `Quote #${quote.quoteNo} submitted by merchandiser for approval.`);
  res.json(updated);
});

quotesRouter.post('/:id/approve', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  if (quote.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: `Quote is ${quote.status}, not pending approval` });

  const quoteNo = quote.quoteNo.startsWith('DRAFT-') ? `Q-${new Date().getFullYear()}-${quoteId.toString().padStart(4, '0')}` : quote.quoteNo;

  const updated = await prisma.quote.update({
    where: { id: quoteId },
    data: { status: 'APPROVED', approvedById: req.user!.userId, approvedAt: new Date(), quoteNo, remarks: req.body?.remarks },
  });
  await notifyUser(quote.createdById, 'Quote approved', `Quote #${quoteNo} was approved.`);
  res.json(updated);
});

quotesRouter.post('/:id/reject', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  if (quote.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: `Quote is ${quote.status}, not pending approval` });

  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks : undefined;
  const updated = await prisma.quote.update({
    where: { id: quoteId },
    data: { status: 'REJECTED', approvedById: req.user!.userId, approvedAt: new Date(), remarks },
  });
  await notifyUser(quote.createdById, 'Quote rejected', `Quote #${quote.quoteNo} was rejected.${remarks ? ` Reason: ${remarks}` : ''}`);
  res.json(updated);
});

quotesRouter.post('/:id/mark-sent', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  if (quote.status !== 'APPROVED') return res.status(409).json({ error: 'Only approved quotes can be marked sent' });
  res.json(await prisma.quote.update({ where: { id: quoteId }, data: { status: 'SENT', sentAt: new Date() } }));
});

// Supervisor/Admin: final approval of the negotiated price - generates the irrevocable
// finalReferenceNo (quoteNo itself keeps working through every negotiation round) and
// freezes every price-mutating action from here on (see assertNotLocked above; Admin can
// still bypass it as an emergency escape hatch).
quotesRouter.post('/:id/lock', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  if (quote.locked) return res.status(409).json({ error: 'Quote is already locked' });
  if (quote.status !== 'SENT') return res.status(409).json({ error: 'Only a quote that has been sent to the customer can be locked' });

  // One last snapshot capturing the price exactly as it stood the moment before lock.
  await snapshotIfNeeded(quoteId, req.user!.userId);

  const finalReferenceNo = `REF-${new Date().getFullYear()}-${quoteId.toString().padStart(4, '0')}`;
  const updated = await prisma.quote.update({
    where: { id: quoteId },
    data: { locked: true, lockedAt: new Date(), lockedById: req.user!.userId, finalReferenceNo },
  });
  await notifyUser(quote.createdById, 'Quote locked & finalized', `Quote #${quote.quoteNo} finalized. Reference #: ${finalReferenceNo}.`);
  res.json(updated);
});

quotesRouter.get('/:id/revisions', async (req, res) => {
  const quoteId = Number(req.params.id);
  const revisions = await prisma.quoteRevision.findMany({
    where: { quoteId },
    orderBy: { revisionNo: 'asc' },
    include: { createdBy: { select: { name: true } } },
  });
  res.json(revisions.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshotJson) })));
});

const enquiryStatuses = ['CONVERTED_TO_ORDER', 'LOST_PRICE', 'LOST_MOQ', 'LOST_LEAD_TIME'];

quotesRouter.post('/:id/status', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const status = req.body?.status;
  if (!enquiryStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${enquiryStatuses.join(', ')}` });
  }

  const isSupervisor = req.user!.role === 'SUPERVISOR' || req.user!.role === 'ADMIN';
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  if (quote.createdById !== req.user!.userId && !isSupervisor) return res.status(403).json({ error: 'Not your quote' });
  if (quote.status !== 'SENT') return res.status(409).json({ error: 'Only a quote that has been sent to the customer can get an outcome' });

  res.json(await prisma.quote.update({ where: { id: quoteId }, data: { status } }));
});
