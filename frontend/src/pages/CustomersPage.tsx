import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Customer } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';
import { ImportExportBar } from '../components/ImportExportBar';

const empty = {
  name: '',
  paymentTerms: '',
  freightTerms: '',
  wcInterestPct: 1,
  lcInterestPct: 1,
  marginPct: -3,
  commissionPct: 3,
};

export function CustomersPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);

  function load() {
    api.get<Customer[]>('/customers').then(setItems).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(empty);
    setShowForm(true);
  }
  function openEdit(c: Customer) {
    setEditing(c);
    setForm({
      name: c.name,
      paymentTerms: c.paymentTerms || '',
      freightTerms: c.freightTerms || '',
      wcInterestPct: c.wcInterestPct * 100,
      lcInterestPct: c.lcInterestPct * 100,
      marginPct: c.marginPct * 100,
      commissionPct: c.commissionPct * 100,
    });
    setShowForm(true);
  }

  async function save() {
    const payload = {
      name: form.name,
      paymentTerms: form.paymentTerms,
      freightTerms: form.freightTerms,
      wcInterestPct: form.wcInterestPct / 100,
      lcInterestPct: form.lcInterestPct / 100,
      marginPct: form.marginPct / 100,
      commissionPct: form.commissionPct / 100,
    };
    try {
      if (editing) await api.put(`/customers/${editing.id}`, payload);
      else await api.post('/customers', payload);
      setShowForm(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>Customer Based Mapping</h2>
        {canEdit && (
          <button className="btn primary" onClick={openNew}>
            + Add customer
          </button>
        )}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <ImportExportBar
        exportUrl="/customers/export.xlsx"
        exportFilename="customers.xlsx"
        importUrl="/customers/import"
        canEdit={canEdit}
        onImported={load}
      />
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Payment Terms</th>
              <th>Freight Terms</th>
              <th className="right">W.C. Int %</th>
              <th className="right">LC Int %</th>
              <th className="right">Margin %</th>
              <th className="right">Commission %</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.paymentTerms}</td>
                <td className="muted">{c.freightTerms}</td>
                <td className="right mono">{(c.wcInterestPct * 100).toFixed(2)}</td>
                <td className="right mono">{(c.lcInterestPct * 100).toFixed(2)}</td>
                <td className="right mono">{(c.marginPct * 100).toFixed(2)}</td>
                <td className="right mono">{(c.commissionPct * 100).toFixed(2)}</td>
                {canEdit && (
                  <td className="right">
                    <button className="btn small" onClick={() => openEdit(c)}>
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
        <Modal title={editing ? 'Edit customer' : 'New customer'} onClose={() => setShowForm(false)}>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Customer name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Payment terms</label>
              <input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Freight terms</label>
              <input value={form.freightTerms} onChange={(e) => setForm({ ...form, freightTerms: e.target.value })} />
            </div>
            <div className="field">
              <label>W.C. Interest %</label>
              <input type="number" step="0.01" value={form.wcInterestPct} onChange={(e) => setForm({ ...form, wcInterestPct: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>LC Interest %</label>
              <input type="number" step="0.01" value={form.lcInterestPct} onChange={(e) => setForm({ ...form, lcInterestPct: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Margin % (negative adds margin)</label>
              <input type="number" step="0.01" value={form.marginPct} onChange={(e) => setForm({ ...form, marginPct: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Commission %</label>
              <input type="number" step="0.01" value={form.commissionPct} onChange={(e) => setForm({ ...form, commissionPct: Number(e.target.value) })} />
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
