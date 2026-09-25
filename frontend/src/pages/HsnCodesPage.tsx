import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { HsnCode } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';

const empty = { description: '', hsCode: '', uom: 'PCS', dbkPct: 0, rosctlRodepPct: 0 };

export function HsnCodesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<HsnCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<HsnCode | null>(null);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);

  function load() {
    api.get<HsnCode[]>('/hsn-codes').then(setItems).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(empty);
    setShowForm(true);
  }
  function openEdit(it: HsnCode) {
    setEditing(it);
    setForm({
      description: it.description,
      hsCode: it.hsCode,
      uom: it.uom,
      dbkPct: it.dbkPct * 100,
      rosctlRodepPct: it.rosctlRodepPct * 100,
    });
    setShowForm(true);
  }

  async function save() {
    try {
      const payload = { ...form, dbkPct: form.dbkPct / 100, rosctlRodepPct: form.rosctlRodepPct / 100 };
      if (editing) await api.put(`/hsn-codes/${editing.id}`, payload);
      else await api.post('/hsn-codes', payload);
      setShowForm(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>HSN Master - Duty Drawback / ROSCTL-RODEP</h2>
        {canEdit && (
          <button className="btn primary" onClick={openNew}>
            + Add HSN code
          </button>
        )}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>HS Code</th>
              <th>UOM</th>
              <th className="right">DBK %</th>
              <th className="right">ROSCTL/RODEP %</th>
              <th className="right">Total Incentive %</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.description}</td>
                <td className="mono">{it.hsCode}</td>
                <td>{it.uom}</td>
                <td className="right mono">{(it.dbkPct * 100).toFixed(2)}%</td>
                <td className="right mono">{(it.rosctlRodepPct * 100).toFixed(2)}%</td>
                <td className="right mono">{((it.dbkPct + it.rosctlRodepPct) * 100).toFixed(2)}%</td>
                {canEdit && (
                  <td className="right">
                    <button className="btn small" onClick={() => openEdit(it)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title={editing ? 'Edit HSN code' : 'New HSN code'} onClose={() => setShowForm(false)}>
          <div className="form-grid">
            <div className="field">
              <label>Description</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Bath Towel" />
            </div>
            <div className="field">
              <label>HS Code</label>
              <input value={form.hsCode} onChange={(e) => setForm({ ...form, hsCode: e.target.value })} placeholder="e.g. 63049250" />
            </div>
            <div className="field">
              <label>UOM</label>
              <input value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} placeholder="e.g. PCS" />
            </div>
            <div className="field">
              <label>DBK %</label>
              <input type="number" step="0.01" value={form.dbkPct} onChange={(e) => setForm({ ...form, dbkPct: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>ROSCTL/RODEP %</label>
              <input
                type="number"
                step="0.01"
                value={form.rosctlRodepPct}
                onChange={(e) => setForm({ ...form, rosctlRodepPct: Number(e.target.value) })}
              />
            </div>
          </div>
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
    </div>
  );
}
