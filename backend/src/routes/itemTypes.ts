import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const itemTypesRouter = Router();
itemTypesRouter.use(requireAuth);

itemTypesRouter.get('/', async (_req, res) => {
  res.json(await prisma.itemType.findMany({ orderBy: { name: 'asc' } }));
});

const schema = z.object({
  name: z.string().min(1),
  stitchingCostPerKg: z.number().nonnegative(),
  packingCostPerKg: z.number().nonnegative(),
});

itemTypesRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.itemType.create({ data: parsed.data }));
});

itemTypesRouter.put('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await prisma.itemType.update({ where: { id: Number(req.params.id) }, data: parsed.data }));
});
