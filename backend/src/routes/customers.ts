import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get('/', async (_req, res) => {
  res.json(await prisma.customer.findMany({ orderBy: { name: 'asc' } }));
});

customersRouter.get('/:id', async (req, res) => {
  const customer = await prisma.customer.findUnique({ where: { id: Number(req.params.id) } });
  if (!customer) return res.status(404).json({ error: 'Not found' });
  res.json(customer);
});

const schema = z.object({
  name: z.string().min(1),
  paymentTerms: z.string().optional(),
  freightTerms: z.string().optional(),
  wcInterestPct: z.number().min(0).max(1),
  lcInterestPct: z.number().min(0).max(1),
  marginPct: z.number().min(-1).max(1),
  commissionPct: z.number().min(-1).max(1),
});

customersRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(await prisma.customer.create({ data: parsed.data }));
});

customersRouter.put('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await prisma.customer.update({ where: { id: Number(req.params.id) }, data: parsed.data }));
});
