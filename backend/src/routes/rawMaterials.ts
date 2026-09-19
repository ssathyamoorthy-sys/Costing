import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { resolveCurrentRate } from '../lib/rates';
import { notifyRole, notifyUser } from '../lib/notify';

export const rawMaterialsRouter = Router();
rawMaterialsRouter.use(requireAuth);

// --- Raw material catalogue (Supervisor maintains the list of yarn types) ---

rawMaterialsRouter.get('/', async (_req, res) => {
  const materials = await prisma.rawMaterial.findMany({ orderBy: { code: 'asc' } });
  const withRates = await Promise.all(
    materials.map(async (m) => ({ ...m, currentRate: await resolveCurrentRate(m.id) })),
  );
  res.json(withRates);
});

const materialSchema = z.object({
  code: z.string().min(1),
  description: z.string().optional(),
});

rawMaterialsRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = materialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const material = await prisma.rawMaterial.create({ data: parsed.data });
  res.status(201).json(material);
});

// --- Rates: Purchase submits, Supervisor approves/rejects ---

rawMaterialsRouter.get('/rates/pending', requireRole('SUPERVISOR', 'ADMIN'), async (_req, res) => {
  const rates = await prisma.rawMaterialRate.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: { rawMaterial: true, enteredBy: { select: { name: true } } },
  });
  res.json(rates);
});

rawMaterialsRouter.get('/:id/rates', async (req, res) => {
  const rates = await prisma.rawMaterialRate.findMany({
    where: { rawMaterialId: Number(req.params.id) },
    orderBy: { createdAt: 'desc' },
    include: { enteredBy: { select: { name: true } }, approvedBy: { select: { name: true } } },
  });
  res.json(rates);
});

const newRateSchema = z.object({
  pricePerKg: z.number().positive(),
  validFrom: z.string().datetime().or(z.string().min(1)),
  validTo: z.string().datetime().or(z.string().min(1)).optional().nullable(),
});

rawMaterialsRouter.post('/:id/rates', requireRole('PURCHASE', 'ADMIN'), async (req, res) => {
  const parsed = newRateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const rawMaterialId = Number(req.params.id);
  const rate = await prisma.rawMaterialRate.create({
    data: {
      rawMaterialId,
      pricePerKg: parsed.data.pricePerKg,
      validFrom: new Date(parsed.data.validFrom),
      validTo: parsed.data.validTo ? new Date(parsed.data.validTo) : null,
      status: 'PENDING',
      enteredById: req.user!.userId,
    },
  });

  const material = await prisma.rawMaterial.findUnique({ where: { id: rawMaterialId } });
  await notifyRole(
    'SUPERVISOR',
    'Rate approval needed',
    `New rate ₹${parsed.data.pricePerKg}/kg submitted for "${material?.code}" - awaiting your approval.`,
  );

  res.status(201).json(rate);
});

rawMaterialsRouter.post('/rates/:rateId/approve', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const rateId = Number(req.params.rateId);
  const toApprove = await prisma.rawMaterialRate.findUnique({ where: { id: rateId } });
  if (!toApprove) return res.status(404).json({ error: 'Rate not found' });

  // Close out any still-open approved rate for the same material so "current rate"
  // is never ambiguous between two open-ended APPROVED rows.
  await prisma.rawMaterialRate.updateMany({
    where: {
      rawMaterialId: toApprove.rawMaterialId,
      status: 'APPROVED',
      validTo: null,
      id: { not: rateId },
    },
    data: { validTo: toApprove.validFrom },
  });

  const rate = await prisma.rawMaterialRate.update({
    where: { id: rateId },
    data: { status: 'APPROVED', approvedById: req.user!.userId, approvedAt: new Date() },
  });

  await notifyUser(rate.enteredById, `Rate approved`, `Your submitted rate ₹${rate.pricePerKg}/kg was approved.`);
  res.json(rate);
});

rawMaterialsRouter.post('/rates/:rateId/reject', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const rateId = Number(req.params.rateId);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
  const rate = await prisma.rawMaterialRate.update({
    where: { id: rateId },
    data: { status: 'REJECTED', approvedById: req.user!.userId, approvedAt: new Date(), rejectReason: reason },
  });

  await notifyUser(
    rate.enteredById,
    `Rate rejected`,
    `Your submitted rate ₹${rate.pricePerKg}/kg was rejected.${reason ? ` Reason: ${reason}` : ''}`,
  );
  res.json(rate);
});
