import { prisma } from './prisma';

export type AuditEntityType = 'Product' | 'Customer' | 'ProcessingCharge' | 'HsnCode' | 'ExchangeRate' | 'GeneralSetting';

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// Never diffed: identity/bookkeeping columns, not a "change" a supervisor needs to see.
const SKIP_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v ?? null;
}

function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown>): FieldChange[] {
  const changes: FieldChange[] = [];
  // Only ever iterate the fields actually present in `after` (what's actually being
  // written) - callers pass a PARTIAL object on update (only the submitted fields), and
  // comparing against every field of `before` would falsely flag every unsubmitted field
  // as "changed to null".
  for (const key of Object.keys(after)) {
    if (SKIP_FIELDS.has(key)) continue;
    // Only plain scalars are ever passed in by callers below, but skip defensively in case a
    // nested relation object slips through - it's never meaningful to diff those here.
    if (typeof after[key] === 'object' && after[key] !== null && !(after[key] instanceof Date)) continue;
    const newValue = normalize(after[key]);
    const oldValue = before ? normalize(before[key]) : undefined;
    if (before && oldValue === newValue) continue;
    changes.push({ field: key, oldValue: before ? oldValue : undefined, newValue });
  }
  return changes;
}

/**
 * Records one audit-log entry for a create or update on a master record. `before`/`after`
 * should be plain scalar field objects (no relations) - pass null `before` for a create. A
 * no-op update (nothing actually changed) is silently skipped rather than logged as noise.
 */
export async function recordAuditLog(opts: {
  entityType: AuditEntityType;
  entityId: number;
  entityLabel: string;
  action: 'CREATE' | 'UPDATE';
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  changedById: number;
}) {
  const changes = diffFields(opts.before, opts.after);
  if (opts.action === 'UPDATE' && changes.length === 0) return;

  await prisma.auditLog.create({
    data: {
      entityType: opts.entityType,
      entityId: opts.entityId,
      entityLabel: opts.entityLabel,
      action: opts.action,
      changesJson: JSON.stringify(changes),
      changedById: opts.changedById,
    },
  });
}
