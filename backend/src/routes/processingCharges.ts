import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const processingChargesRouter = Router();
processingChargesRouter.use(requireAuth);

processingChargesRouter.get('/', async (_req, res) => {
  res.json(await prisma.processingCharge.findMany({ orderBy: { color: 'asc' } }));
});

const schema = z.object({ color: z.string().min(1), ratePerKg: z.number().nonnegative() });

processingChargesRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.processingCharge.create({ data: parsed.data }));
});

processingChargesRouter.put('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await prisma.processingCharge.update({ where: { id: Number(req.params.id) }, data: parsed.data }));
});
