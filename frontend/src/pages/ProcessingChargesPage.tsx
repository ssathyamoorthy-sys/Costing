import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { ProcessingCharge } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';

const empty = { color: '', ratePerKg: 0 };

export function ProcessingChargesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<ProcessingCharge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProcessingCharge | null>(null);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);

  function load() {
    api.get<ProcessingCharge[]>('/processing-charges').then(setItems).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(empty);
    setShowForm(true);
  }
  function openEdit(it: ProcessingCharge) {
    setEditing(it);
    setForm({ color: it.color, ratePerKg: it.ratePerKg });
    setShowForm(true);
  }

  async function save() {
    try {
      if (editing) await api.put(`/processing-charges/${editing.id}`, form);
      else await api.post('/processing-charges', form);
      setShowForm(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>Processing Charges by Color</h2>
        {canEdit && (
          <button className="btn primary" onClick={openNew}>
            + Add color
          </button>
        )}
      </div>
      <p className="muted">Used on every quote line - the color entered must match one of these exactly.</p>
      {error && <Alert type="error">{error}</Alert>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Color</th>
              <th className="right">Rate/Kg</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.color}</td>
                <td className="right mono">₹{it.ratePerKg}</td>
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
        <Modal title={editing ? 'Edit processing charge' : 'New processing charge'} onClose={() => setShowForm(false)}>
          <div className="form-grid">
            <div className="field">
              <label>Color</label>
              <input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="e.g. White" />
            </div>
            <div className="field">
              <label>Rate / kg (₹)</label>
              <input type="number" value={form.ratePerKg} onChange={(e) => setForm({ ...form, ratePerKg: Number(e.target.value) })} />
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
