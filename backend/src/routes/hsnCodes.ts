import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { recordAuditLog } from '../lib/auditLog';

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
  const hsn = await prisma.hsnCode.create({ data: parsed.data });
  await recordAuditLog({
    entityType: 'HsnCode',
    entityId: hsn.id,
    entityLabel: `${hsn.hsCode} - ${hsn.description}`,
    action: 'CREATE',
    before: null,
    after: parsed.data,
    changedById: req.user!.userId,
  });
  res.status(201).json(hsn);
});

hsnCodesRouter.put('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const id = Number(req.params.id);
  const before = await prisma.hsnCode.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ error: 'Not found' });

  const hsn = await prisma.hsnCode.update({ where: { id }, data: parsed.data });
  await recordAuditLog({
    entityType: 'HsnCode',
    entityId: hsn.id,
    entityLabel: `${hsn.hsCode} - ${hsn.description}`,
    action: 'UPDATE',
    before,
    after: parsed.data,
    changedById: req.user!.userId,
  });
  res.json(hsn);
});
