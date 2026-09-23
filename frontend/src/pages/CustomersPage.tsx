import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Currency, Customer, Region } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';
import { ImportExportBar } from '../components/ImportExportBar';
import { COUNTRIES } from '../countries';

const REGIONS: Region[] = ['Asia', 'Europe', 'UK', 'US', 'Oceania', 'Far East', 'Domestic (India)'];
const CURRENCIES: Currency[] = ['INR', 'USD', 'GBP', 'EUR'];

const empty = {
  name: '',
  region: 'Domestic (India)' as Region,
  countries: [] as string[],
  currency: 'INR' as Currency,
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
      region: c.region,
      countries: c.countries ? c.countries.split(',') : [],
      currency: c.currency,
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
      region: form.region,
      countries: form.countries,
      currency: form.currency,
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
              <th>Region</th>
              <th>Countries</th>
              <th>Currency</th>
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
                <td className="muted">{c.region}</td>
                <td className="muted">{c.countries?.split(',').join(', ')}</td>
                <td className="muted">{c.region === 'Domestic (India)' ? 'INR' : c.currency}</td>
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
            <div className="field">
              <label>Region</label>
              <select
                value={form.region}
                onChange={(e) => {
                  const region = e.target.value as Region;
                  setForm({ ...form, region, currency: region === 'Domestic (India)' ? 'INR' : form.currency });
                }}
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Currency {form.region === 'Domestic (India)' && <span className="muted">(Domestic is always INR)</span>}</label>
              <select
                value={form.currency}
                disabled={form.region === 'Domestic (India)'}
                onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Countries (ctrl/cmd-click to select multiple)</label>
              <select
                multiple
                size={6}
                value={form.countries}
                onChange={(e) => setForm({ ...form, countries: Array.from(e.target.selectedOptions, (o) => o.value) })}
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
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
            <button className="btn primary" onClick={save} disabled={!form.name || form.countries.length === 0}>
              Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
