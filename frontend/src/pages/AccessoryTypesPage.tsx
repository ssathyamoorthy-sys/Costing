import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { AccessoryType } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';

export function AccessoryTypesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<AccessoryType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  function load() {
    api.get<AccessoryType[]>('/accessory-types').then(setItems).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function add() {
    if (!newName.trim()) return;
    try {
      await api.post('/accessory-types', { name: newName.trim() });
      setNewName('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>Accessory Types</h2>
      </div>
      <p className="muted">
        Standard trims/accessories (Brand, Wash Care, Barcode, Tag, etc.). Default per-piece cost for each is set per product in the
        Product Master, and merchandisers can override it per quote line.
      </p>
      {error && <Alert type="error">{error}</Alert>}
      <div className="panel">
        {canEdit && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <input placeholder="New accessory type name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }} />
            <button className="btn primary" onClick={add}>
              Add
            </button>
          </div>
        )}
        <div className="tag-row">
          {items.map((it) => (
            <span key={it.id} className="badge draft">
              {it.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
