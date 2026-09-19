import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const accessoryTypesRouter = Router();
accessoryTypesRouter.use(requireAuth);

accessoryTypesRouter.get('/', async (_req, res) => {
  res.json(await prisma.accessoryType.findMany({ orderBy: { name: 'asc' } }));
});

const schema = z.object({ name: z.string().min(1) });

accessoryTypesRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.accessoryType.create({ data: parsed.data }));
});
