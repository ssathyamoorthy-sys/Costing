import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type {
  Product,
  ScenarioRule,
  ScenarioRuleActionField,
  ScenarioRuleConditionField,
  ScenarioRuleConditionOperator,
  ScenarioRuleScopeType,
} from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';
import { SearchableSelect } from '../components/SearchableSelect';
import { SortableTh } from '../components/SortableTh';
import { useSortableTable } from '../hooks/useSortableTable';

const SCOPE_LABELS: Record<ScenarioRuleScopeType, string> = {
  ALL: 'All products',
  COLOR_METHOD_YARN_DYED: 'Yarn dyed products',
  PRODUCT: 'Specific product',
};
const FIELD_LABELS: Record<ScenarioRuleConditionField, string> = { ORDER_QTY_KG: 'Order Qty (Kg)', GSM: 'GSM' };
const ACTION_FIELD_LABELS: Record<ScenarioRuleActionField, string> = {
  REJECTION_PCT: 'Rejection %',
  WEAVING_SIZING_COST_PER_KG: 'Weaving cost/Kg',
};

// The action value is entered/edited in the unit that matches the chosen action field -
// percentage points for Rejection %, a flat Rs./kg amount for Weaving cost/Kg - rather than
// always storing the raw fraction computeSet.ts uses, so a merchandiser-readable "3" means
// "3%" instead of an opaque "0.03".
interface RuleForm {
  name: string;
  active: boolean;
  scopeType: ScenarioRuleScopeType;
  scopeProductId: number | '';
  conditionField: ScenarioRuleConditionField;
  conditionOperator: ScenarioRuleConditionOperator;
  conditionValue: string;
  actionField: ScenarioRuleActionField;
  actionValueInput: string;
}

function emptyForm(): RuleForm {
  return {
    name: '',
    active: true,
    scopeType: 'ALL',
    scopeProductId: '',
    conditionField: 'ORDER_QTY_KG',
    conditionOperator: '<',
    conditionValue: '1000',
    actionField: 'REJECTION_PCT',
    actionValueInput: '5',
  };
}

function describeRule(r: ScenarioRule): string {
  const scope = r.scopeType === 'PRODUCT' ? `Product: ${r.scopeProduct?.code ?? `#${r.scopeProductId}`}` : SCOPE_LABELS[r.scopeType];
  const action =
    r.actionField === 'REJECTION_PCT'
      ? `increase Rejection % by ${(r.actionValue * 100).toFixed(1)}%`
      : `increase Weaving cost by Rs.${r.actionValue.toFixed(2)}/kg`;
  return `IF ${scope}, ${FIELD_LABELS[r.conditionField]} ${r.conditionOperator} ${r.conditionValue} THEN ${action}`;
}

export function ScenarioRulesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [rules, setRules] = useState<ScenarioRule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScenarioRule | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ScenarioRule | null>(null);

  function load() {
    api.get<ScenarioRule[]>('/scenario-rules').then(setRules).catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }
  useEffect(load, []);

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rules, {
    name: (r) => r.name,
    active: (r) => (r.active ? 1 : 0),
  });
  useEffect(() => {
    api.get<Product[]>('/products').then(setProducts).catch(() => {});
  }, []);

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setShowForm(true);
  }
  function openEdit(r: ScenarioRule) {
    setEditing(r);
    setForm({
      name: r.name,
      active: r.active,
      scopeType: r.scopeType,
      scopeProductId: r.scopeProductId ?? '',
      conditionField: r.conditionField,
      conditionOperator: r.conditionOperator,
      conditionValue: String(r.conditionValue),
      actionField: r.actionField,
      actionValueInput: String(r.actionField === 'REJECTION_PCT' ? r.actionValue * 100 : r.actionValue),
    });
    setShowForm(true);
  }

  async function save() {
    setError(null);
    const payload = {
      name: form.name.trim(),
      active: form.active,
      scopeType: form.scopeType,
      scopeProductId: form.scopeType === 'PRODUCT' ? Number(form.scopeProductId) || null : null,
      conditionField: form.conditionField,
      conditionOperator: form.conditionOperator,
      conditionValue: Number(form.conditionValue),
      actionField: form.actionField,
      actionValue: form.actionField === 'REJECTION_PCT' ? Number(form.actionValueInput) / 100 : Number(form.actionValueInput),
    };
    try {
      if (editing) await api.put(`/scenario-rules/${editing.id}`, payload);
      else await api.post('/scenario-rules', payload);
      setShowForm(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  function remove(r: ScenarioRule) {
    setConfirmDelete(r);
  }
  async function doRemove(r: ScenarioRule) {
    try {
      await api.del(`/scenario-rules/${r.id}`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>Scenario Rules</h2>
        {canEdit && (
          <button className="btn primary" onClick={openNew}>
            + Add rule
          </button>
        )}
      </div>
      <p className="muted">
        Admin-configurable costing adjustments: IF a Set matches a scope and condition, THEN a cost input is increased automatically,
        with a warning shown on the quote explaining why.
      </p>
      {error && <Alert type="error">{error}</Alert>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <SortableTh label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <th>Rule</th>
              <SortableTh label="Active" sortKey="active" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="muted">{describeRule(r)}</td>
                <td>
                  <span className={`badge ${r.active ? 'approved' : 'rejected'}`}>{r.active ? 'Active' : 'Inactive'}</span>
                </td>
                {canEdit && (
                  <td className="right">
                    <div className="tag-row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn small" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                      <button className="btn small danger" onClick={() => remove(r)}>
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 4 : 3} className="muted">
                  No scenario rules yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title={editing ? 'Edit scenario rule' : 'New scenario rule'} onClose={() => setShowForm(false)}>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Yarn-dyed MOQ shortfall" />
            </div>
            <div className="field">
              <label>Scope</label>
              <select
                value={form.scopeType}
                onChange={(e) => setForm({ ...form, scopeType: e.target.value as ScenarioRuleScopeType, scopeProductId: '' })}
              >
                <option value="ALL">All products</option>
                <option value="COLOR_METHOD_YARN_DYED">Yarn dyed products</option>
                <option value="PRODUCT">Specific product</option>
              </select>
            </div>
            {form.scopeType === 'PRODUCT' && (
              <div className="field">
                <label>Product</label>
                <SearchableSelect<number>
                  value={form.scopeProductId}
                  onChange={(v) => setForm({ ...form, scopeProductId: v })}
                  options={products.map((p) => ({ value: p.id, label: p.code, sublabel: p.name ?? undefined }))}
                />
              </div>
            )}
            <div className="field">
              <label>IF field</label>
              <select value={form.conditionField} onChange={(e) => setForm({ ...form, conditionField: e.target.value as ScenarioRuleConditionField })}>
                <option value="ORDER_QTY_KG">Order Qty (Kg)</option>
                <option value="GSM">GSM</option>
              </select>
            </div>
            <div className="field">
              <label>Operator</label>
              <select
                value={form.conditionOperator}
                onChange={(e) => setForm({ ...form, conditionOperator: e.target.value as ScenarioRuleConditionOperator })}
              >
                <option value="<">&lt;</option>
                <option value="<=">&lt;=</option>
                <option value=">">&gt;</option>
                <option value=">=">&gt;=</option>
                <option value="==">=</option>
              </select>
            </div>
            <div className="field">
              <label>Value</label>
              <input type="number" value={form.conditionValue} onChange={(e) => setForm({ ...form, conditionValue: e.target.value })} />
            </div>
            <div className="field">
              <label>THEN increase</label>
              <select value={form.actionField} onChange={(e) => setForm({ ...form, actionField: e.target.value as ScenarioRuleActionField })}>
                <option value="REJECTION_PCT">Rejection %</option>
                <option value="WEAVING_SIZING_COST_PER_KG">Weaving cost/Kg</option>
              </select>
            </div>
            <div className="field">
              <label>By ({form.actionField === 'REJECTION_PCT' ? '%' : 'Rs./kg'})</label>
              <input type="number" value={form.actionValueInput} onChange={(e) => setForm({ ...form, actionValueInput: e.target.value })} />
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} style={{ marginRight: 6 }} />
                Active
              </label>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            {`IF ${form.scopeType === 'PRODUCT' ? 'Product: ' + (products.find((p) => p.id === form.scopeProductId)?.code ?? '...') : SCOPE_LABELS[form.scopeType]}, ${FIELD_LABELS[form.conditionField]} ${form.conditionOperator} ${form.conditionValue || '...'} THEN ${ACTION_FIELD_LABELS[form.actionField]} increased by ${form.actionValueInput || '...'}${form.actionField === 'REJECTION_PCT' ? '%' : ' Rs./kg'}`}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={save}>
              Save
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Delete scenario rule" onClose={() => setConfirmDelete(null)}>
          <p style={{ marginTop: 0 }}>Delete the rule "{confirmDelete.name}"? This can't be undone.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              onClick={() => {
                const r = confirmDelete;
                setConfirmDelete(null);
                doRemove(r);
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
