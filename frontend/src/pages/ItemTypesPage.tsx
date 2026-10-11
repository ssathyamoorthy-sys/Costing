import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { ItemType, SizingMethod } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';

const empty: { name: string; stitchingCostPerKg: number; packingCostPerKg: number; sizingMethod: SizingMethod; stitchingCostPerPiece: number } = {
  name: '',
  stitchingCostPerKg: 0,
  packingCostPerKg: 0,
  sizingMethod: 'DIMENSIONS',
  stitchingCostPerPiece: 0,
};

export function ItemTypesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<ItemType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ItemType | null>(null);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);

  function load() {
    api.get<ItemType[]>('/item-types').then(setItems).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(empty);
    setShowForm(true);
  }
  function openEdit(it: ItemType) {
    setEditing(it);
    setForm({
      name: it.name,
      stitchingCostPerKg: it.stitchingCostPerKg,
      packingCostPerKg: it.packingCostPerKg,
      sizingMethod: it.sizingMethod ?? 'DIMENSIONS',
      stitchingCostPerPiece: it.stitchingCostPerPiece ?? 0,
    });
    setShowForm(true);
  }

  async function save() {
    try {
      if (editing) await api.put(`/item-types/${editing.id}`, form);
      else await api.post('/item-types', form);
      setShowForm(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>Item Types - Stitching &amp; Packing Cost/Kg</h2>
        {canEdit && (
          <button className="btn primary" onClick={openNew}>
            + Add item type
          </button>
        )}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Item Type</th>
              <th>Sizing</th>
              <th className="right">Stitching Cost</th>
              <th className="right">Packing Cost/Kg</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.name}</td>
                <td>{it.sizingMethod === 'FABRIC_CONSUMPTION' ? 'Fabric consumption (garment)' : 'L x W (flat)'}</td>
                <td className="right mono">
                  {it.sizingMethod === 'FABRIC_CONSUMPTION' ? `₹${it.stitchingCostPerPiece}/pc` : `₹${it.stitchingCostPerKg}/kg`}
                </td>
                <td className="right mono">₹{it.packingCostPerKg}</td>
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
        <Modal title={editing ? 'Edit item type' : 'New item type'} onClose={() => setShowForm(false)}>
          <div className="form-grid">
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bath Towel" />
            </div>
            <div className="field">
              <label>Sizing method</label>
              <select value={form.sizingMethod} onChange={(e) => setForm({ ...form, sizingMethod: e.target.value as 'DIMENSIONS' | 'FABRIC_CONSUMPTION' })}>
                <option value="DIMENSIONS">L x W x GSM (flat items, e.g. towels)</option>
                <option value="FABRIC_CONSUMPTION">Fabric consumption x GSM (garments, e.g. bathrobes)</option>
              </select>
            </div>
            {form.sizingMethod === 'FABRIC_CONSUMPTION' ? (
              <div className="field">
                <label>Stitching cost / piece (₹)</label>
                <input type="number" value={form.stitchingCostPerPiece} onChange={(e) => setForm({ ...form, stitchingCostPerPiece: Number(e.target.value) })} />
              </div>
            ) : (
              <div className="field">
                <label>Stitching cost / kg (₹)</label>
                <input type="number" value={form.stitchingCostPerKg} onChange={(e) => setForm({ ...form, stitchingCostPerKg: Number(e.target.value) })} />
              </div>
            )}
            <div className="field">
              <label>Packing cost / kg (₹)</label>
              <input type="number" value={form.packingCostPerKg} onChange={(e) => setForm({ ...form, packingCostPerKg: Number(e.target.value) })} />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Packing cost stays per-kg either way, by design - packaging scales with the item's actual weight.
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
    </div>
  );
}
