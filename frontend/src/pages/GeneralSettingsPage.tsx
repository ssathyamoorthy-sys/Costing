import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';

interface Setting {
  key: string;
  value: string;
}

const LABELS: Record<string, string> = {
  freightExportPerKg: 'Export freight (₹/kg)',
  yarnDyedMoqKg: 'Yarn-dyed MOQ (Kg per article)',
  moqShortfallRejectionPct: 'MOQ shortfall rejection surcharge (fraction, e.g. 0.05 = 5%)',
};

export function GeneralSettingsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<Setting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  function load() {
    api.get<Setting[]>('/general-settings').then((rows) => {
      setItems(rows);
      setEdits(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    });
  }
  useEffect(load, []);

  async function save(key: string) {
    try {
      await api.put(`/general-settings/${key}`, { value: edits[key] });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function addSetting() {
    if (!newKey.trim() || !newValue.trim()) return;
    try {
      await api.put(`/general-settings/${newKey.trim()}`, { value: newValue.trim() });
      setNewKey('');
      setNewValue('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>General Mapping</h2>
      </div>
      <p className="muted">Company-wide costing settings that don't vary by product or customer.</p>
      {error && <Alert type="error">{error}</Alert>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Setting</th>
              <th className="right">Value</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.key}>
                <td>{LABELS[s.key] || s.key}</td>
                <td className="right">
                  <input
                    style={{ width: 120, textAlign: 'right' }}
                    value={edits[s.key] ?? ''}
                    onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
                    disabled={!canEdit}
                  />
                </td>
                {canEdit && (
                  <td className="right">
                    <button className="btn small" onClick={() => save(s.key)}>
                      Save
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Add a new setting</h3>
          <div className="tag-row">
            <input
              placeholder="Key (e.g. minimumOrderQty)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
            />
            <input
              placeholder="Value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              style={{ width: 160, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
            />
            <button className="btn primary" onClick={addSetting}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
