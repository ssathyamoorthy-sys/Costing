import { Fragment, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Customer, QuoteTemplate, QuoteTemplateGroup, QuoteTemplateGroupSummary, QuoteTemplateSummary } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';

function templateSizeLabel(item: { lengthCm: number; widthCm: number; fabricConsumptionSqm?: number | null }) {
  return item.fabricConsumptionSqm ? `${item.fabricConsumptionSqm} sqm fabric` : `${item.widthCm}x${item.lengthCm}cm`;
}

export function TemplatesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'MERCHANDISER' || user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [templates, setTemplates] = useState<QuoteTemplateSummary[]>([]);
  const [groups, setGroups] = useState<QuoteTemplateGroupSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<{ kind: 'template' | 'group'; id: number } | null>(null);
  const [renameInput, setRenameInput] = useState('');

  const [expanded, setExpanded] = useState<{ kind: 'template' | 'group'; id: number } | null>(null);
  const [expandedTemplate, setExpandedTemplate] = useState<QuoteTemplate | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<QuoteTemplateGroup | null>(null);

  useEffect(() => {
    api.get<Customer[]>('/customers').then(setCustomers);
  }, []);

  function load() {
    if (!customerId) return;
    api
      .get<QuoteTemplateSummary[]>(`/quote-templates?customerId=${customerId}&standaloneOnly=true`)
      .then(setTemplates)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
    api
      .get<QuoteTemplateGroupSummary[]>(`/quote-template-groups?customerId=${customerId}`)
      .then(setGroups)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }
  useEffect(load, [customerId]);

  function startRename(kind: 'template' | 'group', id: number, currentName: string) {
    setRenaming({ kind, id });
    setRenameInput(currentName);
  }

  async function saveRename() {
    if (!renaming) return;
    setError(null);
    try {
      const path = renaming.kind === 'template' ? `/quote-templates/${renaming.id}` : `/quote-template-groups/${renaming.id}`;
      await api.put(path, { name: renameInput });
      setRenaming(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function deleteTemplate(id: number, name: string) {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/quote-templates/${id}`);
      if (expanded?.kind === 'template' && expanded.id === id) setExpanded(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function deleteGroup(id: number, name: string) {
    if (!confirm(`Delete recipe "${name}" and all its sets? This cannot be undone.`)) return;
    try {
      await api.del(`/quote-template-groups/${id}`);
      if (expanded?.kind === 'group' && expanded.id === id) setExpanded(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function toggleExpandTemplate(id: number) {
    if (expanded?.kind === 'template' && expanded.id === id) {
      setExpanded(null);
      return;
    }
    const t = await api.get<QuoteTemplate>(`/quote-templates/${id}`);
    setExpandedTemplate(t);
    setExpanded({ kind: 'template', id });
  }

  async function toggleExpandGroup(id: number) {
    if (expanded?.kind === 'group' && expanded.id === id) {
      setExpanded(null);
      return;
    }
    const g = await api.get<QuoteTemplateGroup>(`/quote-template-groups/${id}`);
    setExpandedGroup(g);
    setExpanded({ kind: 'group', id });
  }

  function templateContents(t: QuoteTemplate) {
    return (
      <div className="panel" style={{ marginTop: 8, background: 'var(--bg)' }}>
        {t.segments.map((seg, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>
              {seg.product?.code}
              {seg.product?.name ? ` - ${seg.product.name}` : ''}
            </strong>
            <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
              Yarn: {seg.yarnComponents.map((y) => `${y.slot} ${y.mixingPct}%`).join(', ')}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Size</th>
                  <th className="right">GSM</th>
                  <th className="right">Qty/Set</th>
                </tr>
              </thead>
              <tbody>
                {seg.items.map((item, ii) => (
                  <tr key={ii}>
                    <td>{item.itemType?.name}</td>
                    <td>{templateSizeLabel(item)}</td>
                    <td className="right mono">{item.gsm}</td>
                    <td className="right mono">{item.qtyPerSet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <h2>Quote Templates</h2>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <p className="muted" style={{ marginTop: -6 }}>
        Saved recipes are per customer. Rename or delete them here; to change a template's actual recipe (yarn,
        items, pricing), build it correctly on a live quote and use "Save as template" with the same name again -
        you'll be offered the option to overwrite it.
      </p>

      <div className="panel">
        <div className="field" style={{ maxWidth: 360 }}>
          <label>Customer</label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Select...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {customerId && (
        <>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Single-set templates</h3>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Color</th>
                  <th>Article Ref</th>
                  <th className="right">Qty Sets</th>
                  <th>Created by</th>
                  <th>Created</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <Fragment key={t.id}>
                    <tr>
                      <td>
                        {renaming?.kind === 'template' && renaming.id === t.id ? (
                          <div className="tag-row">
                            <input value={renameInput} onChange={(e) => setRenameInput(e.target.value)} style={{ width: 200 }} />
                            <button className="btn small primary" onClick={saveRename}>
                              Save
                            </button>
                            <button className="btn small" onClick={() => setRenaming(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button className="btn small" onClick={() => toggleExpandTemplate(t.id)}>
                            {expanded?.kind === 'template' && expanded.id === t.id ? 'Hide' : 'View'}
                          </button>
                        )}{' '}
                        {!(renaming?.kind === 'template' && renaming.id === t.id) && t.name}
                      </td>
                      <td className="muted">{t.color}</td>
                      <td className="muted">{t.articleRef}</td>
                      <td className="right mono">{t.qtySets}</td>
                      <td className="muted">{t.createdBy?.name}</td>
                      <td className="muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                      {canEdit && (
                        <td className="right">
                          <div className="tag-row" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn small" onClick={() => startRename('template', t.id, t.name)}>
                              Rename
                            </button>
                            <button className="btn small danger" onClick={() => deleteTemplate(t.id, t.name)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {expanded?.kind === 'template' && expanded.id === t.id && expandedTemplate && (
                      <tr>
                        <td colSpan={canEdit ? 7 : 6}>{templateContents(expandedTemplate)}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {templates.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 7 : 6} className="muted">
                      No single-set templates saved for this customer yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Whole-quote recipes</h3>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="right">Sets</th>
                  <th>Created by</th>
                  <th>Created</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.id}>
                    <tr>
                      <td>
                        {renaming?.kind === 'group' && renaming.id === g.id ? (
                          <div className="tag-row">
                            <input value={renameInput} onChange={(e) => setRenameInput(e.target.value)} style={{ width: 200 }} />
                            <button className="btn small primary" onClick={saveRename}>
                              Save
                            </button>
                            <button className="btn small" onClick={() => setRenaming(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button className="btn small" onClick={() => toggleExpandGroup(g.id)}>
                            {expanded?.kind === 'group' && expanded.id === g.id ? 'Hide' : 'View'}
                          </button>
                        )}{' '}
                        {!(renaming?.kind === 'group' && renaming.id === g.id) && g.name}
                      </td>
                      <td className="right mono">{g.setCount}</td>
                      <td className="muted">{g.createdBy?.name}</td>
                      <td className="muted">{new Date(g.createdAt).toLocaleDateString()}</td>
                      {canEdit && (
                        <td className="right">
                          <div className="tag-row" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn small" onClick={() => startRename('group', g.id, g.name)}>
                              Rename
                            </button>
                            <button className="btn small danger" onClick={() => deleteGroup(g.id, g.name)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {expanded?.kind === 'group' && expanded.id === g.id && expandedGroup && (
                      <tr>
                        <td colSpan={canEdit ? 5 : 4}>
                          {expandedGroup.templates.map((t, i) => (
                            <div key={t.id}>
                              <strong style={{ fontSize: 13 }}>Set {i + 1}</strong>
                              {templateContents(t)}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 5 : 4} className="muted">
                      No whole-quote recipes saved for this customer yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
