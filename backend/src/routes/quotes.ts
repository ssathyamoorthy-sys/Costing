import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { computeQuoteLine } from '../costing/computeLine';
import { notifyRole, notifyUser } from '../lib/notify';

export const quotesRouter = Router();
quotesRouter.use(requireAuth);

const lineFull = {
  product: { include: { itemType: true } },
  itemType: true,
  accessoryOverrides: { include: { accessoryType: true } },
  materialOverrides: { include: { rawMaterial: true } },
} as const;

quotesRouter.get('/', async (req, res) => {
  const mine = req.query.mine === 'true';
  const quotes = await prisma.quote.findMany({
    where: mine ? { createdById: req.user!.userId } : undefined,
    include: { customer: true, createdBy: { select: { name: true } }, lines: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(quotes);
});

quotesRouter.get('/:id', async (req, res) => {
  const quote = await prisma.quote.findUnique({
    where: { id: Number(req.params.id) },
    include: { customer: true, createdBy: { select: { name: true } }, approvedBy: { select: { name: true } }, lines: { include: lineFull } },
  });
  if (!quote) return res.status(404).json({ error: 'Not found' });
  res.json(quote);
});

const createQuoteSchema = z.object({
  customerId: z.number().int().positive(),
  currencies: z.array(z.enum(['INR', 'USD', 'GBP', 'EUR'])).min(1).default(['INR', 'USD', 'GBP']),
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
      currencies: parsed.data.currencies.join(','),
      validityDate: parsed.data.validityDate ? new Date(parsed.data.validityDate) : undefined,
      paymentTerms: customer.paymentTerms,
      freightTerms: customer.freightTerms,
    },
  });
  res.status(201).json(quote);
});

const lineSchema = z.object({
  productId: z.number().int().positive(),
  color: z.string().min(1),
  lengthCm: z.number().positive(),
  widthCm: z.number().positive(),
  gsm: z.number().positive(),
  qtyPcs: z.number().int().positive(),
  targetPrice: z.number().optional(),
  accessoryOverrides: z.array(z.object({ accessoryTypeId: z.number(), costPerPiece: z.number().nonnegative() })).optional(),
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

quotesRouter.post('/:id/lines', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const quoteId = Number(req.params.id);
  const isSupervisor = req.user!.role === 'SUPERVISOR' || req.user!.role === 'ADMIN';
  const check = await assertEditableByOwner(quoteId, req.user!.userId, isSupervisor);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const parsed = lineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const product = await prisma.product.findUnique({ where: { id: parsed.data.productId } });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  try {
    const { breakup, warnings } = await computeQuoteLine({
      productId: parsed.data.productId,
      customerId: check.quote.customerId,
      color: parsed.data.color,
      lengthCm: parsed.data.lengthCm,
      widthCm: parsed.data.widthCm,
      gsm: parsed.data.gsm,
      qtyPcs: parsed.data.qtyPcs,
      currencies: check.quote.currencies.split(','),
    });

    const line = await prisma.quoteLine.create({
      data: {
        quoteId,
        productId: parsed.data.productId,
        itemTypeId: product.itemTypeId,
        color: parsed.data.color,
        lengthCm: parsed.data.lengthCm,
        widthCm: parsed.data.widthCm,
        gsm: parsed.data.gsm,
        qtyPcs: parsed.data.qtyPcs,
        targetPrice: parsed.data.targetPrice,
        pieceWeightGrams: breakup.pieceWeightGrams,
        qtyKg: breakup.qtyKg,
        costBreakupJson: JSON.stringify(breakup),
        ratePerKgInr: breakup.ratePerKg.INR,
        ratePerPieceInr: breakup.ratePerPiece.INR,
        ratePerKgUsd: breakup.ratePerKg.USD,
        ratePerPieceUsd: breakup.ratePerPiece.USD,
        ratePerKgGbp: breakup.ratePerKg.GBP,
        ratePerPieceGbp: breakup.ratePerPiece.GBP,
        ratePerKgEur: breakup.ratePerKg.EUR,
        ratePerPieceEur: breakup.ratePerPiece.EUR,
        accessoryOverrides: parsed.data.accessoryOverrides
          ? { create: parsed.data.accessoryOverrides }
          : undefined,
      },
      include: lineFull,
    });

    res.status(201).json({ line, warnings });
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

  const parsed = lineSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.quoteLine.findUnique({ where: { id: lineId } });
  if (!existing || existing.quoteId !== quoteId) return res.status(404).json({ error: 'Line not found' });

  const merged = {
    productId: parsed.data.productId ?? existing.productId,
    color: parsed.data.color ?? existing.color,
    lengthCm: parsed.data.lengthCm ?? existing.lengthCm,
    widthCm: parsed.data.widthCm ?? existing.widthCm,
    gsm: parsed.data.gsm ?? existing.gsm,
    qtyPcs: parsed.data.qtyPcs ?? existing.qtyPcs,
  };

  if (parsed.data.accessoryOverrides) {
    await prisma.quoteLineAccessory.deleteMany({ where: { quoteLineId: lineId } });
    await prisma.quoteLineAccessory.createMany({
      data: parsed.data.accessoryOverrides.map((a) => ({ ...a, quoteLineId: lineId })),
    });
  }

  try {
    const { breakup, warnings } = await computeQuoteLine({
      ...merged,
      customerId: check.quote.customerId,
      currencies: check.quote.currencies.split(','),
      quoteLineId: lineId,
    });

    const product = await prisma.product.findUnique({ where: { id: merged.productId } });

    const line = await prisma.quoteLine.update({
      where: { id: lineId },
      data: {
        ...merged,
        itemTypeId: product!.itemTypeId,
        targetPrice: parsed.data.targetPrice ?? existing.targetPrice,
        pieceWeightGrams: breakup.pieceWeightGrams,
        qtyKg: breakup.qtyKg,
        costBreakupJson: JSON.stringify(breakup),
        ratePerKgInr: breakup.ratePerKg.INR,
        ratePerPieceInr: breakup.ratePerPiece.INR,
        ratePerKgUsd: breakup.ratePerKg.USD,
        ratePerPieceUsd: breakup.ratePerPiece.USD,
        ratePerKgGbp: breakup.ratePerKg.GBP,
        ratePerPieceGbp: breakup.ratePerPiece.GBP,
        ratePerKgEur: breakup.ratePerKg.EUR,
        ratePerPieceEur: breakup.ratePerPiece.EUR,
      },
      include: lineFull,
    });

    res.json({ line, warnings });
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

// Supervisor: override one raw material's price for a specific quote line (one-off, notifies Purchase)
const overrideSchema = z.object({ rawMaterialId: z.number().int().positive(), overridePricePerKg: z.number().positive(), reason: z.string().optional() });

quotesRouter.post('/:id/lines/:lineId/material-override', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const lineId = Number(req.params.lineId);
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const line = await prisma.quoteLine.findUnique({ where: { id: lineId }, include: { quote: true } });
  if (!line) return res.status(404).json({ error: 'Line not found' });

  const material = await prisma.rawMaterial.findUnique({ where: { id: parsed.data.rawMaterialId } });
  if (!material) return res.status(404).json({ error: 'Raw material not found' });

  const existingOverride = await prisma.quoteLineMaterialOverride.findFirst({
    where: { quoteLineId: lineId, rawMaterialId: parsed.data.rawMaterialId },
  });
  if (existingOverride) {
    await prisma.quoteLineMaterialOverride.update({
      where: { id: existingOverride.id },
      data: { overridePricePerKg: parsed.data.overridePricePerKg, reason: parsed.data.reason, setById: req.user!.userId },
    });
  } else {
    await prisma.quoteLineMaterialOverride.create({
      data: {
        quoteLineId: lineId,
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
    `Quote #${line.quote.quoteNo}: supervisor overrode "${material.code}" to ₹${parsed.data.overridePricePerKg}/kg for this quote only.${parsed.data.reason ? ` Reason: ${parsed.data.reason}` : ''}`,
  );

  // Recompute the line with the new override applied
  const { breakup, warnings } = await computeQuoteLine({
    productId: line.productId,
    customerId: line.quote.customerId,
    color: line.color,
    lengthCm: line.lengthCm,
    widthCm: line.widthCm,
    gsm: line.gsm,
    qtyPcs: line.qtyPcs,
    currencies: line.quote.currencies.split(','),
    quoteLineId: lineId,
  });

  const updated = await prisma.quoteLine.update({
    where: { id: lineId },
    data: {
      costBreakupJson: JSON.stringify(breakup),
      ratePerKgInr: breakup.ratePerKg.INR,
      ratePerPieceInr: breakup.ratePerPiece.INR,
      ratePerKgUsd: breakup.ratePerKg.USD,
      ratePerPieceUsd: breakup.ratePerPiece.USD,
      ratePerKgGbp: breakup.ratePerKg.GBP,
      ratePerPieceGbp: breakup.ratePerPiece.GBP,
      ratePerKgEur: breakup.ratePerKg.EUR,
      ratePerPieceEur: breakup.ratePerPiece.EUR,
    },
    include: lineFull,
  });

  res.json({ line: updated, warnings });
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
