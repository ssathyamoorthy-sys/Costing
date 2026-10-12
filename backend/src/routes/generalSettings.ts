import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { recordAuditLog } from '../lib/auditLog';

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

  const before = await prisma.generalSetting.findUnique({ where: { key } });
  const setting = await prisma.generalSetting.upsert({
    where: { key },
    update: { value: parsed.data.value },
    create: { key, value: parsed.data.value },
  });
  await recordAuditLog({
    entityType: 'GeneralSetting',
    entityId: setting.id,
    entityLabel: setting.key,
    action: before ? 'UPDATE' : 'CREATE',
    before: before ? { value: before.value } : null,
    after: { value: setting.value },
    changedById: req.user!.userId,
  });
  res.json(setting);
});
