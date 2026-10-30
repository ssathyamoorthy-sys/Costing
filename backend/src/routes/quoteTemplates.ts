import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const quoteTemplatesRouter = Router();
quoteTemplatesRouter.use(requireAuth);

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

quoteTemplatesRouter.get('/', async (req, res) => {
  const customerId = Number(req.query.customerId);
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  // Templates that only exist as a member of a whole-quote recipe (auto-named "<group name> -
  // Set N") are still useful to pick individually from a quote line's "Load from template"
  // dropdown - but the Templates management page lists recipes separately and would just show
  // the same set twice, so it opts into hiding them here.
  const standaloneOnly = req.query.standaloneOnly === 'true';
  const templates = await prisma.quoteTemplate.findMany({
    where: { customerId, ...(standaloneOnly ? { groupMemberships: { none: {} } } : {}) },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, color: true, articleRef: true, qtySets: true, createdAt: true, createdBy: { select: { name: true } } },
  });
  res.json(templates);
});

quoteTemplatesRouter.get('/:id', async (req, res) => {
  const template = await prisma.quoteTemplate.findUnique({
    where: { id: Number(req.params.id) },
    include: templateFull,
  });
  if (!template) return res.status(404).json({ error: 'Not found' });
  res.json(template);
});

// Rename only - to edit a template's actual recipe (yarn/items/pricing), build it correctly
// in a live quote and "Save as template" with the same name again (see
// POST /quotes/:id/lines/:lineId/save-as-template's overwrite option).
const renameSchema = z.object({ name: z.string().min(1) });

quoteTemplatesRouter.put('/:id', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const id = Number(req.params.id);
  const existing = await prisma.quoteTemplate.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const nameTaken = await prisma.quoteTemplate.findFirst({
    where: { customerId: existing.customerId, name: parsed.data.name, id: { not: id } },
  });
  if (nameTaken) return res.status(409).json({ error: `A template named "${parsed.data.name}" already exists for this customer` });

  const template = await prisma.quoteTemplate.update({ where: { id }, data: { name: parsed.data.name } });
  res.json(template);
});

quoteTemplatesRouter.delete('/:id', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = Number(req.params.id);
  // A template that's a member of a saved whole-quote recipe would otherwise cascade-delete
  // its membership row too, silently shrinking that recipe by one set - block it instead and
  // point at the group, which is the right place to remove/replace a set from a recipe.
  const membership = await prisma.quoteTemplateGroupMember.findFirst({ where: { templateId: id }, include: { group: true } });
  if (membership) {
    return res.status(409).json({ error: `This template is part of the "${membership.group.name}" recipe - delete that recipe instead if you no longer need it.` });
  }
  await prisma.quoteTemplate.delete({ where: { id } });
  res.status(204).send();
});
