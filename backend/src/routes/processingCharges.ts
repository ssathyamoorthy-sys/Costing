import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { recordAuditLog } from '../lib/auditLog';

export const processingChargesRouter = Router();
processingChargesRouter.use(requireAuth);

processingChargesRouter.get('/', async (_req, res) => {
  res.json(await prisma.processingCharge.findMany({ orderBy: { color: 'asc' } }));
});

const schema = z.object({ color: z.string().min(1), ratePerKg: z.number().nonnegative() });

processingChargesRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const charge = await prisma.processingCharge.create({ data: parsed.data });
  await recordAuditLog({
    entityType: 'ProcessingCharge',
    entityId: charge.id,
    entityLabel: charge.color,
    action: 'CREATE',
    before: null,
    after: parsed.data,
    changedById: req.user!.userId,
  });
  res.status(201).json(charge);
});

processingChargesRouter.put('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const id = Number(req.params.id);
  const before = await prisma.processingCharge.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ error: 'Not found' });

  const charge = await prisma.processingCharge.update({ where: { id }, data: parsed.data });
  await recordAuditLog({
    entityType: 'ProcessingCharge',
    entityId: charge.id,
    entityLabel: charge.color,
    action: 'UPDATE',
    before,
    after: parsed.data,
    changedById: req.user!.userId,
  });
  res.json(charge);
});
