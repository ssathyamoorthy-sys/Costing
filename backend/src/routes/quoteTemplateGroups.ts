import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const quoteTemplateGroupsRouter = Router();
quoteTemplateGroupsRouter.use(requireAuth);

const templateFull = {
  segments: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      product: true,
      yarnComponents: { include: { rawMaterial: true } },
      items: {
        include: {
          itemType: true,
          accessoryOverrides: { include: { accessoryType: true } },
          packagingCharges: true,
        },
      },
    },
  },
} as const;

quoteTemplateGroupsRouter.get('/', async (req, res) => {
  const customerId = Number(req.query.customerId);
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  const groups = await prisma.quoteTemplateGroup.findMany({
    where: { customerId },
    orderBy: { name: 'asc' },
    include: { members: { select: { id: true } }, createdBy: { select: { name: true } } },
  });
  res.json(groups.map((g) => ({ id: g.id, name: g.name, createdAt: g.createdAt, createdBy: g.createdBy, setCount: g.members.length })));
});

// Full detail, including each member template's complete segment/yarn/item recipe, so the
// frontend can build and submit every line in one pass without extra round trips.
quoteTemplateGroupsRouter.get('/:id', async (req, res) => {
  const group = await prisma.quoteTemplateGroup.findUnique({
    where: { id: Number(req.params.id) },
    include: { members: { orderBy: { sortOrder: 'asc' }, include: { template: { include: templateFull } } } },
  });
  if (!group) return res.status(404).json({ error: 'Not found' });
  res.json({ id: group.id, name: group.name, templates: group.members.map((m) => m.template) });
});

const renameSchema = z.object({ name: z.string().min(1) });

quoteTemplateGroupsRouter.put('/:id', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const id = Number(req.params.id);
  const existing = await prisma.quoteTemplateGroup.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const nameTaken = await prisma.quoteTemplateGroup.findFirst({
    where: { customerId: existing.customerId, name: parsed.data.name, id: { not: id } },
  });
  if (nameTaken) return res.status(409).json({ error: `A recipe named "${parsed.data.name}" already exists for this customer` });

  const group = await prisma.quoteTemplateGroup.update({ where: { id }, data: { name: parsed.data.name } });
  res.json(group);
});

// Member templates only exist to serve this group (auto-created by save-as-template-group),
// so deleting the group also deletes them - otherwise they'd linger as orphaned entries in
// the per-line "Load from template" dropdown.
quoteTemplateGroupsRouter.delete('/:id', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const group = await prisma.quoteTemplateGroup.findUnique({
    where: { id: Number(req.params.id) },
    include: { members: true },
  });
  if (!group) return res.status(404).json({ error: 'Not found' });

  await prisma.quoteTemplate.deleteMany({ where: { id: { in: group.members.map((m) => m.templateId) } } });
  await prisma.quoteTemplateGroup.delete({ where: { id: group.id } });
  res.status(204).send();
});
