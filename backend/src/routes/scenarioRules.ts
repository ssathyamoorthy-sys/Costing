import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { recordAuditLog } from '../lib/auditLog';
import { SCOPE_TYPES, CONDITION_FIELDS, CONDITION_OPERATORS, ACTION_FIELDS } from '../costing/computeSet';

export const scenarioRulesRouter = Router();
scenarioRulesRouter.use(requireAuth);

// Visible to every role (not just Supervisor/Admin) - these rules change the price a
// merchandiser sees, so they should be able to see why, not just that a warning appeared.
scenarioRulesRouter.get('/', async (_req, res) => {
  res.json(
    await prisma.scenarioRule.findMany({
      orderBy: { id: 'asc' },
      include: { scopeProduct: { select: { code: true, name: true } }, createdBy: { select: { name: true } } },
    }),
  );
});

const baseSchema = z.object({
  name: z.string().min(1),
  active: z.boolean().optional(),
  scopeType: z.enum(SCOPE_TYPES),
  scopeProductId: z.number().int().positive().optional().nullable(),
  conditionField: z.enum(CONDITION_FIELDS),
  conditionOperator: z.enum(CONDITION_OPERATORS),
  conditionValue: z.number(),
  actionField: z.enum(ACTION_FIELDS),
  actionValue: z.number(),
});

// scopeProductId only makes sense (and is only required) when scopeType is PRODUCT - checked
// outside the zod schema itself so PUT can validate it against the merged (existing + partial
// update) shape, not just whatever subset of fields this one request happened to include.
function scopeError(scopeType: string, scopeProductId: number | null | undefined): string | null {
  if (scopeType === 'PRODUCT' && scopeProductId == null) return 'scopeProductId is required when scopeType is PRODUCT';
  if (scopeType !== 'PRODUCT' && scopeProductId != null) return 'scopeProductId must be left empty unless scopeType is PRODUCT';
  return null;
}

scenarioRulesRouter.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = baseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const scopeErr = scopeError(parsed.data.scopeType, parsed.data.scopeProductId);
  if (scopeErr) return res.status(400).json({ error: scopeErr });

  const rule = await prisma.scenarioRule.create({
    data: { ...parsed.data, createdById: req.user!.userId },
    include: { scopeProduct: { select: { code: true, name: true } }, createdBy: { select: { name: true } } },
  });
  await recordAuditLog({
    entityType: 'ScenarioRule',
    entityId: rule.id,
    entityLabel: rule.name,
    action: 'CREATE',
    before: null,
    after: parsed.data,
    changedById: req.user!.userId,
  });
  res.status(201).json(rule);
});

scenarioRulesRouter.put('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = baseSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const id = Number(req.params.id);
  const before = await prisma.scenarioRule.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ error: 'Not found' });

  const mergedScopeType = parsed.data.scopeType ?? before.scopeType;
  const mergedScopeProductId = parsed.data.scopeProductId !== undefined ? parsed.data.scopeProductId : before.scopeProductId;
  const scopeErr = scopeError(mergedScopeType, mergedScopeProductId);
  if (scopeErr) return res.status(400).json({ error: scopeErr });

  const rule = await prisma.scenarioRule.update({
    where: { id },
    data: parsed.data,
    include: { scopeProduct: { select: { code: true, name: true } }, createdBy: { select: { name: true } } },
  });
  await recordAuditLog({
    entityType: 'ScenarioRule',
    entityId: rule.id,
    entityLabel: rule.name,
    action: 'UPDATE',
    before,
    after: parsed.data,
    changedById: req.user!.userId,
  });
  res.json(rule);
});

scenarioRulesRouter.delete('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.scenarioRule.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ error: 'Not found' });

  await prisma.scenarioRule.delete({ where: { id } });
  await recordAuditLog({
    entityType: 'ScenarioRule',
    entityId: id,
    entityLabel: before.name,
    action: 'DELETE',
    before,
    after: null,
    changedById: req.user!.userId,
  });
  res.status(204).send();
});
