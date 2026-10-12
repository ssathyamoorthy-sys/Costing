import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { getCurrentExchangeRates } from '../lib/exchangeRates';
import { recordAuditLog } from '../lib/auditLog';

export const exchangeRatesRouter = Router();
exchangeRatesRouter.use(requireAuth);

exchangeRatesRouter.get('/', async (_req, res) => {
  res.json(await prisma.exchangeRate.findMany({ orderBy: [{ currency: 'asc' }, { validFrom: 'desc' }] }));
});

exchangeRatesRouter.get('/current', async (_req, res) => {
  res.json(await getCurrentExchangeRates());
});

const schema = z.object({
  currency: z.enum(['USD', 'GBP', 'EUR']),
  ratePerInr: z.number().positive(),
  validFrom: z.string().min(1),
});

exchangeRatesRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const rate = await prisma.exchangeRate.create({
    data: {
      currency: parsed.data.currency,
      ratePerInr: parsed.data.ratePerInr,
      validFrom: new Date(parsed.data.validFrom),
      enteredById: req.user!.userId,
    },
  });
  // Rates are append-only (a new row per change, never edited in place) - enteredById
  // already captures who, but logging here too keeps it in the one unified change-log report
  // alongside the other masters instead of needing a separate view just for this one.
  await recordAuditLog({
    entityType: 'ExchangeRate',
    entityId: rate.id,
    entityLabel: rate.currency,
    action: 'CREATE',
    before: null,
    after: { currency: rate.currency, ratePerInr: rate.ratePerInr, validFrom: rate.validFrom },
    changedById: req.user!.userId,
  });
  res.status(201).json(rate);
});
