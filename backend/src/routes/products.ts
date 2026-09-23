import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateMixing } from '../costing/engine';
import { buildWorkbook, parseWorkbookSheet } from '../xlsx/helpers';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get('/', async (_req, res) => {
  const products = await prisma.product.findMany({
    include: {
      yarnComponents: { include: { rawMaterial: true } },
      accessories: { include: { accessoryType: true } },
    },
    orderBy: { code: 'asc' },
  });
  res.json(products);
});

// NOTE: these two fixed-path routes must stay registered before GET /:id,
// otherwise Express matches "export.xlsx" as the :id param.
productsRouter.get('/export.xlsx', requireRole('SUPERVISOR', 'ADMIN'), async (_req, res) => {
  const products = await prisma.product.findMany({
    include: { yarnComponents: { include: { rawMaterial: true } } },
    orderBy: { code: 'asc' },
  });

  const productRows = products.map((p) => ({
    code: p.code,
    name: p.name ?? '',
    weavingWastagePct: p.weavingWastagePct * 100,
    weavingSizingCostPerKg: p.weavingSizingCostPerKg,
    firstVelourCharges: p.firstVelourCharges,
    firstVelourLossPct: p.firstVelourLossPct * 100,
    secondVelourCharges: p.secondVelourCharges,
    secondVelourLossPct: p.secondVelourLossPct * 100,
    weightLossPct: p.weightLossPct * 100,
    transportLocalPerKg: p.transportLocalPerKg,
    rejectionPct: p.rejectionPct * 100,
  }));

  const yarnRows = products.flatMap((p) =>
    p.yarnComponents.map((c) => ({
      productCode: p.code,
      slot: c.slot,
      rawMaterialCode: c.rawMaterial.code,
      mixingPct: c.mixingPct,
    })),
  );

  const wb = buildWorkbook([
    {
      name: 'Products',
      columns: [
        { header: 'code', key: 'code' },
        { header: 'name', key: 'name', width: 26 },
        { header: 'weavingWastagePct', key: 'weavingWastagePct', width: 16 },
        { header: 'weavingSizingCostPerKg', key: 'weavingSizingCostPerKg', width: 20 },
        { header: 'firstVelourCharges', key: 'firstVelourCharges', width: 16 },
        { header: 'firstVelourLossPct', key: 'firstVelourLossPct', width: 16 },
        { header: 'secondVelourCharges', key: 'secondVelourCharges', width: 16 },
        { header: 'secondVelourLossPct', key: 'secondVelourLossPct', width: 16 },
        { header: 'weightLossPct', key: 'weightLossPct', width: 14 },
        { header: 'transportLocalPerKg', key: 'transportLocalPerKg', width: 16 },
        { header: 'rejectionPct', key: 'rejectionPct', width: 14 },
      ],
      rows: productRows,
    },
    {
      name: 'YarnComponents',
      columns: [
        { header: 'productCode', key: 'productCode', width: 16 },
        { header: 'slot', key: 'slot', width: 14 },
        { header: 'rawMaterialCode', key: 'rawMaterialCode', width: 18 },
        { header: 'mixingPct', key: 'mixingPct', width: 12 },
      ],
      rows: yarnRows,
    },
  ]);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

productsRouter.post('/import', requireRole('SUPERVISOR', 'ADMIN'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
  try {
    const productRows = await parseWorkbookSheet(req.file.buffer, 'Products');
    const yarnRows = await parseWorkbookSheet(req.file.buffer, 'YarnComponents');

    const rawMaterials = await prisma.rawMaterial.findMany();
    const rawMaterialByCode = new Map(rawMaterials.map((m) => [m.code.toLowerCase(), m]));

    const yarnByProductCode = new Map<string, { slot: string; rawMaterialId: number; mixingPct: number }[]>();
    for (const row of yarnRows) {
      const code = row.productCode?.trim();
      if (!code) continue;
      const material = rawMaterialByCode.get((row.rawMaterialCode || '').trim().toLowerCase());
      if (!material) throw new Error(`YarnComponents row for "${code}": raw material "${row.rawMaterialCode}" not found`);
      const list = yarnByProductCode.get(code) ?? [];
      list.push({ slot: row.slot?.trim() || '', rawMaterialId: material.id, mixingPct: Number(row.mixingPct) || 0 });
      yarnByProductCode.set(code, list);
    }

    let created = 0;
    let updated = 0;
    const warnings: string[] = [];

    for (const row of productRows) {
      const code = row.code?.trim();
      if (!code) continue;

      const yarnComponents = yarnByProductCode.get(code) ?? [];
      if (yarnComponents.length > 0) {
        const mixing = validateMixing(yarnComponents);
        if (!mixing.ok) warnings.push(`Product "${code}": yarn mixing % totals ${mixing.total}, expected 100.`);
      }

      const data = {
        name: row.name || undefined,
        weavingWastagePct: Number(row.weavingWastagePct || 0) / 100,
        weavingSizingCostPerKg: Number(row.weavingSizingCostPerKg || 0),
        firstVelourCharges: Number(row.firstVelourCharges || 0),
        firstVelourLossPct: Number(row.firstVelourLossPct || 0) / 100,
        secondVelourCharges: Number(row.secondVelourCharges || 0),
        secondVelourLossPct: Number(row.secondVelourLossPct || 0) / 100,
        weightLossPct: Number(row.weightLossPct || 0) / 100,
        transportLocalPerKg: Number(row.transportLocalPerKg || 0),
        rejectionPct: Number(row.rejectionPct || 0) / 100,
      };

      const existing = await prisma.product.findUnique({ where: { code } });
      let productId: number;
      if (existing) {
        await prisma.product.update({ where: { code }, data });
        productId = existing.id;
        updated++;
      } else {
        const createdProduct = await prisma.product.create({ data: { code, ...data } });
        productId = createdProduct.id;
        created++;
      }

      if (yarnComponents.length > 0) {
        await prisma.productYarnComponent.deleteMany({ where: { productId } });
        await prisma.productYarnComponent.createMany({ data: yarnComponents.map((c) => ({ ...c, productId })) });
      }
    }

    res.json({ created, updated, totalRows: productRows.length, warnings });
  } catch (err: any) {
    res.status(422).json({ error: err.message });
  }
});

productsRouter.get('/:id', async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      yarnComponents: { include: { rawMaterial: true } },
      accessories: { include: { accessoryType: true } },
    },
  });
  if (!product) return res.status(404).json({ error: 'Not found' });
  res.json(product);
});

const yarnComponentSchema = z.object({
  slot: z.string().min(1),
  rawMaterialId: z.number().int().positive(),
  mixingPct: z.number().positive(),
});

const productSchema = z.object({
  code: z.string().min(1),
  name: z.string().optional(),
  weavingWastagePct: z.number().min(0).max(1),
  weavingSizingCostPerKg: z.number().nonnegative(),
  firstVelourCharges: z.number().nonnegative(),
  firstVelourLossPct: z.number().min(0).max(1),
  secondVelourCharges: z.number().nonnegative(),
  secondVelourLossPct: z.number().min(0).max(1),
  weightLossPct: z.number().min(0).max(1),
  transportLocalPerKg: z.number().nonnegative(),
  rejectionPct: z.number().min(0).max(1),
  yarnComponents: z.array(yarnComponentSchema).min(1),
  force: z.boolean().optional(), // bypass the mixing-% == 100 warning
});

productsRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { force, yarnComponents, ...productData } = parsed.data;
  const mixing = validateMixing(yarnComponents);
  if (!mixing.ok && !force) {
    return res.status(422).json({
      warning: `Yarn mixing % totals ${mixing.total}, expected 100. Resubmit with force=true to save anyway.`,
      total: mixing.total,
    });
  }

  const product = await prisma.product.create({
    data: {
      ...productData,
      yarnComponents: { create: yarnComponents },
    },
    include: { yarnComponents: true },
  });
  res.status(201).json(product);
});

productsRouter.put('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const id = Number(req.params.id);
  const { force, yarnComponents, ...productData } = parsed.data;

  if (yarnComponents) {
    const mixing = validateMixing(yarnComponents);
    if (!mixing.ok && !force) {
      return res.status(422).json({
        warning: `Yarn mixing % totals ${mixing.total}, expected 100. Resubmit with force=true to save anyway.`,
        total: mixing.total,
      });
    }
    await prisma.productYarnComponent.deleteMany({ where: { productId: id } });
  }

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...productData,
      ...(yarnComponents ? { yarnComponents: { create: yarnComponents } } : {}),
    },
    include: { yarnComponents: true },
  });
  res.json(product);
});

const accessoryDefaultSchema = z.object({
  accessoryTypeId: z.number().int().positive(),
  costPerPiece: z.number().nonnegative(),
});

productsRouter.put('/:id/accessories', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = z.array(accessoryDefaultSchema).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const productId = Number(req.params.id);
  await prisma.productAccessory.deleteMany({ where: { productId } });
  await prisma.productAccessory.createMany({
    data: parsed.data.map((a) => ({ ...a, productId })),
  });
  const accessories = await prisma.productAccessory.findMany({
    where: { productId },
    include: { accessoryType: true },
  });
  res.json(accessories);
});
