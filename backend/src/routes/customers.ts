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
        { header: 'paymentTerms', key: 'paymentTerms', width: 35 },
        { header: 'freightTerms', key: 'freightTerms', width: 30 },
        { header: 'wcInterestPct', key: 'wcInterestPct', width: 14 },
        { header: 'lcInterestPct', key: 'lcInterestPct', width: 14 },
        { header: 'marginPct', key: 'marginPct', width: 12 },
        { header: 'commissionPct', key: 'commissionPct', width: 14 },
      ],
      rows: customers.map((c) => ({
        name: c.name,
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
