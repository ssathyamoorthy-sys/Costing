import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateMixing } from '../costing/engine';

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get('/', async (_req, res) => {
  const products = await prisma.product.findMany({
    include: {
      itemType: true,
      yarnComponents: { include: { rawMaterial: true } },
      accessories: { include: { accessoryType: true } },
    },
    orderBy: { code: 'asc' },
  });
  res.json(products);
});

productsRouter.get('/:id', async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      itemType: true,
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
  itemTypeId: z.number().int().positive(),
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
