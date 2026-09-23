import { Router } from 'express';
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
  const templates = await prisma.quoteTemplate.findMany({
    where: { customerId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, color: true, qtySets: true, createdAt: true, createdBy: { select: { name: true } } },
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

quoteTemplatesRouter.delete('/:id', requireRole('MERCHANDISER', 'SUPERVISOR', 'ADMIN'), async (req, res) => {
  await prisma.quoteTemplate.delete({ where: { id: Number(req.params.id) } });
  res.status(204).send();
});
