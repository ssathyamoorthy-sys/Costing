import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const hsnCodesRouter = Router();
hsnCodesRouter.use(requireAuth);

hsnCodesRouter.get('/', async (_req, res) => {
  res.json(await prisma.hsnCode.findMany({ orderBy: { description: 'asc' } }));
});

const schema = z.object({
  description: z.string().min(1),
  hsCode: z.string().min(1),
  uom: z.string().min(1),
  dbkPct: z.number().nonnegative(),
  rosctlRodepPct: z.number().nonnegative(),
  active: z.boolean().optional(),
});

hsnCodesRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.hsnCode.create({ data: parsed.data }));
});

hsnCodesRouter.put('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await prisma.hsnCode.update({ where: { id: Number(req.params.id) }, data: parsed.data }));
});
