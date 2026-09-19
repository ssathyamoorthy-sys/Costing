import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { ExchangeRate } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';

const empty = { currency: 'USD', ratePerInr: 0, validFrom: new Date().toISOString().slice(0, 10) };

export function ExchangeRatesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<ExchangeRate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);

  function load() {
    api.get<ExchangeRate[]>('/exchange-rates').then(setItems).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function save() {
    try {
      await api.post('/exchange-rates', form);
      setShowForm(false);
      setForm(empty);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const currencies = ['USD', 'GBP', 'EUR'];

  return (
    <div>
      <div className="toolbar">
        <h2>Exchange Rates</h2>
        {canEdit && (
          <button className="btn primary" onClick={() => setShowForm(true)}>
            + Add rate (weekly update)
          </button>
        )}
      </div>
      <p className="muted">INR value of 1 unit of foreign currency. The most recent rate on or before today is used for costing.</p>
      {error && <Alert type="error">{error}</Alert>}
      <div className="panel">
        {currencies.map((cur) => {
          const rows = items.filter((r) => r.currency === cur);
          const current = rows[0];
          return (
            <div key={cur} style={{ marginBottom: 18 }}>
              <h4 style={{ margin: '0 0 6px' }}>
                {cur} {current ? <span className="mono">- ₹{current.ratePerInr} (since {new Date(current.validFrom).toLocaleDateString()})</span> : <span className="muted">no rate on file</span>}
              </h4>
              {rows.length > 1 && (
                <table>
                  <thead>
                    <tr>
                      <th>Rate</th>
                      <th>Valid From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(1).map((r) => (
                      <tr key={r.id}>
                        <td className="mono">₹{r.ratePerInr}</td>
                        <td>{new Date(r.validFrom).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {showForm && (
        <Modal title="New exchange rate" onClose={() => setShowForm(false)}>
          <div className="form-grid">
            <div className="field">
              <label>Currency</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Rate (INR per 1 unit)</label>
              <input type="number" value={form.ratePerInr} onChange={(e) => setForm({ ...form, ratePerInr: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Valid from</label>
              <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
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
