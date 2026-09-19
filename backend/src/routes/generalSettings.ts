import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const generalSettingsRouter = Router();
generalSettingsRouter.use(requireAuth);

generalSettingsRouter.get('/', async (_req, res) => {
  res.json(await prisma.generalSetting.findMany({ orderBy: { key: 'asc' } }));
});

const schema = z.object({ key: z.string().min(1), value: z.string().min(1) });

generalSettingsRouter.put('/:key', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.pick({ value: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const key = req.params.key;
  const setting = await prisma.generalSetting.upsert({
    where: { key },
    update: { value: parsed.data.value },
    create: { key, value: parsed.data.value },
  });
  res.json(setting);
});
