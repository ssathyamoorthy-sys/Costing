import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { computeSet, type SegmentInput } from '../costing/computeSet';
import { notifyRole, notifyUser } from '../lib/notify';
import { generateQuotePdf } from '../pdf/quotePdf';
import { buildWorkbook } from '../xlsx/helpers';
import { buildDetailedQuoteWorkbook } from '../xlsx/buildDetailedQuoteWorkbook';
import type { CostingBreakup } from '../costing/engine';

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
    include: { customer: true, createdBy: { select: { name: true } }, approvedBy: { select: { name: true } }, lines: { include: lineFull } },
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
    { header: 'Qty (Kg)/Set', key: 'qtyKg', width: 13 },
    { header: `Rate/Kg (${currency})`, key: 'rateKg', width: 14 },
    { header: `Rate/Pc (${currency})`, key: 'ratePc', width: 14 },
  ];

  const rows: Record<string, unknown>[] = [];
  quote.lines.forEach((line, li) => {
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
          qtyPerSet: item.qtyPerSet,
          qtyKg: item.qtyKg,
          rateKg: breakup?.ratePerKg?.[currency] ?? '',
          ratePc: breakup?.ratePerPiece?.[currency] ?? '',
        });
      }
    }
    const setRollup: { ratePerSet: Record<string, number> } | null = line.costBreakupJson ? JSON.parse(line.costBreakupJson) : null;
    rows.push({
      item: `Combined rate / set (Set #${li + 1})`,
      ratePc: setRollup?.ratePerSet?.[currency] ?? '',
      qtyPerSet: `${line.qtySets} sets ordered`,
    });
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

  const parsed = lineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.quoteLine.findUnique({ where: { id: lineId } });
  if (!existing || existing.quoteId !== quoteId) return res.status(404).json({ error: 'Line not found' });

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

  await prisma.quoteLine.delete({ where: { id: Number(req.params.lineId) } });
  res.status(204).send();
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

  const material = await prisma.rawMaterial.findUnique({ where: { id: parsed.data.rawMaterialId } });
  if (!material) return res.status(404).json({ error: 'Raw material not found' });

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
  const allSegments = await prisma.quoteLineSegment.findMany({
    where: { quoteLineId },
    orderBy: { sortOrder: 'asc' },
    include: { yarnComponents: true, items: { include: { accessoryOverrides: true, packagingCharges: true } } },
  });

  const result = await computeSet({
    quoteId: segment.quoteLine.quoteId,
    color: segment.quoteLine.color,
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

  const updatedLine = await prisma.quoteLine.update({
    where: { id: quoteLineId },
    data: { costBreakupJson: JSON.stringify({ ratePerSet: result.ratePerSet }) },
    include: lineFull,
  });

  res.json({ line: sanitizeLineForRole(updatedLine, req.user!.role), warnings: result.warnings });
});

// --- Workflow ---

quotesRouter.post('/:id/submit', requireRole('MERCHANDISER', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: { lines: true } });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  if (quote.createdById !== req.user!.userId) return res.status(403).json({ error: 'Not your quote' });
  if (quote.status !== 'DRAFT') return res.status(409).json({ error: `Quote is already ${quote.status}` });
  if (quote.lines.length === 0) return res.status(422).json({ error: 'Add at least one line before submitting' });

  const updated = await prisma.quote.update({ where: { id: quoteId }, data: { status: 'PENDING_APPROVAL' } });
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
  res.json(await prisma.quote.update({ where: { id: quoteId }, data: { status: 'SENT' } }));
});

quotesRouter.post('/:id/status', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const status = req.body?.status;
  if (!['WON', 'LOST'].includes(status)) return res.status(400).json({ error: 'status must be WON or LOST' });
  res.json(await prisma.quote.update({ where: { id: quoteId }, data: { status } }));
});
