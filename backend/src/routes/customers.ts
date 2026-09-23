import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildWorkbook, parseWorkbookSheet } from '../xlsx/helpers';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get('/', async (_req, res) => {
  res.json(await prisma.customer.findMany({ orderBy: { name: 'asc' } }));
});

// NOTE: these two fixed-path routes must stay registered before GET /:id,
// otherwise Express matches "export.xlsx" as the :id param.
customersRouter.get('/export.xlsx', requireRole('SUPERVISOR', 'ADMIN'), async (_req, res) => {
  const customers = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
  const wb = buildWorkbook([
    {
      name: 'Customers',
      columns: [
        { header: 'name', key: 'name', width: 24 },
        { header: 'region', key: 'region', width: 16 },
        { header: 'countries', key: 'countries', width: 30 },
        { header: 'currency', key: 'currency', width: 10 },
        { header: 'paymentTerms', key: 'paymentTerms', width: 35 },
        { header: 'freightTerms', key: 'freightTerms', width: 30 },
        { header: 'wcInterestPct', key: 'wcInterestPct', width: 14 },
        { header: 'lcInterestPct', key: 'lcInterestPct', width: 14 },
        { header: 'marginPct', key: 'marginPct', width: 12 },
        { header: 'commissionPct', key: 'commissionPct', width: 14 },
      ],
      rows: customers.map((c) => ({
        name: c.name,
        region: c.region,
        countries: c.countries,
        currency: c.currency,
        paymentTerms: c.paymentTerms ?? '',
        freightTerms: c.freightTerms ?? '',
        wcInterestPct: c.wcInterestPct * 100,
        lcInterestPct: c.lcInterestPct * 100,
        marginPct: c.marginPct * 100,
        commissionPct: c.commissionPct * 100,
      })),
    },
  ]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="customers.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

customersRouter.post('/import', requireRole('SUPERVISOR', 'ADMIN'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
  try {
    const rows = await parseWorkbookSheet(req.file.buffer, 'Customers');
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const name = row.name?.trim();
      if (!name) continue;
      const data = {
        name,
        region: row.region?.trim() || 'Domestic (India)',
        countries: row.countries?.trim() || '',
        currency: row.currency?.trim() || 'INR',
        paymentTerms: row.paymentTerms || undefined,
        freightTerms: row.freightTerms || undefined,
        wcInterestPct: Number(row.wcInterestPct || 0) / 100,
        lcInterestPct: Number(row.lcInterestPct || 0) / 100,
        marginPct: Number(row.marginPct || 0) / 100,
        commissionPct: Number(row.commissionPct || 0) / 100,
      };
      const existing = await prisma.customer.findUnique({ where: { name } });
      if (existing) {
        await prisma.customer.update({ where: { name }, data });
        updated++;
      } else {
        await prisma.customer.create({ data });
        created++;
      }
    }
    res.json({ created, updated, totalRows: rows.length });
  } catch (err: any) {
    res.status(422).json({ error: err.message });
  }
});

customersRouter.get('/:id', async (req, res) => {
  const customer = await prisma.customer.findUnique({ where: { id: Number(req.params.id) } });
  if (!customer) return res.status(404).json({ error: 'Not found' });
  res.json(customer);
});

export const REGIONS = ['Asia', 'Europe', 'UK', 'US', 'Oceania', 'Far East', 'Domestic (India)'] as const;
export const CURRENCIES = ['INR', 'USD', 'GBP', 'EUR'] as const;

const schema = z.object({
  name: z.string().min(1),
  region: z.enum(REGIONS),
  countries: z.array(z.string().min(1)).min(1),
  currency: z.enum(CURRENCIES),
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
  const { countries, ...rest } = parsed.data;
  res.status(201).json(await prisma.customer.create({ data: { ...rest, countries: countries.join(',') } }));
});

customersRouter.put('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { countries, ...rest } = parsed.data;
  res.json(
    await prisma.customer.update({
      where: { id: Number(req.params.id) },
      data: { ...rest, ...(countries ? { countries: countries.join(',') } : {}) },
    }),
  );
});
