import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { RawMaterial, RawMaterialRate } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';
import { ImportExportBar } from '../components/ImportExportBar';

export function RawMaterialsPage() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const isPurchase = user?.role === 'PURCHASE' || user?.role === 'ADMIN';

  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [pending, setPending] = useState<RawMaterialRate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newMaterialForm, setNewMaterialForm] = useState(false);
  const [materialCode, setMaterialCode] = useState('');
  const [materialDesc, setMaterialDesc] = useState('');

  const [rateForm, setRateForm] = useState<{ materialId: number; code: string } | null>(null);
  const [price, setPrice] = useState(0);
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState('');

  function load() {
    api.get<RawMaterial[]>('/raw-materials').then(setMaterials).catch((e) => setError(e.message));
    if (isSupervisor) {
      api.get<RawMaterialRate[]>('/raw-materials/rates/pending').then(setPending).catch(() => {});
    }
  }
  useEffect(load, [isSupervisor]);

  async function addMaterial() {
    try {
      await api.post('/raw-materials', { code: materialCode, description: materialDesc || undefined });
      setNewMaterialForm(false);
      setMaterialCode('');
      setMaterialDesc('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function submitRate() {
    if (!rateForm) return;
    try {
      await api.post(`/raw-materials/${rateForm.materialId}/rates`, {
        pricePerKg: price,
        validFrom: new Date(validFrom).toISOString(),
        validTo: validTo ? new Date(validTo).toISOString() : null,
      });
      setSuccess(`Rate submitted for ${rateForm.code} - awaiting supervisor approval.`);
      setRateForm(null);
      setPrice(0);
      setValidTo('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function approve(rateId: number) {
    try {
      await api.post(`/raw-materials/rates/${rateId}/approve`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function reject(rateId: number) {
    const reason = prompt('Reason for rejecting this rate (optional):') || undefined;
    try {
      await api.post(`/raw-materials/rates/${rateId}/reject`, { reason });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>Raw Material Master</h2>
        {isSupervisor && (
          <button className="btn primary" onClick={() => setNewMaterialForm(true)}>
            + Add raw material
          </button>
        )}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {success && <Alert type="success">{success}</Alert>}

      {isSupervisor && (
        <ImportExportBar
          exportUrl="/raw-materials/export.xlsx"
          exportFilename="raw_materials.xlsx"
          importUrl="/raw-materials/import"
          canEdit={isSupervisor}
          onImported={load}
        />
      )}

      {isSupervisor && pending.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            Pending approval <span className="badge pending">{pending.length}</span>
          </h3>
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th className="right">Price/Kg</th>
                <th>Valid From</th>
                <th>Submitted by</th>
                <th className="right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{(r as any).rawMaterial?.code}</td>
                  <td className="right mono">₹{r.pricePerKg}</td>
                  <td>{new Date(r.validFrom).toLocaleDateString()}</td>
                  <td className="muted">{r.enteredBy?.name}</td>
                  <td className="right">
                    <button className="btn small success" onClick={() => approve(r.id)} style={{ marginRight: 6 }}>
                      Approve
                    </button>
                    <button className="btn small danger" onClick={() => reject(r.id)}>
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th className="right">Current Rate/Kg</th>
              <th>Valid From</th>
              <th></th>
              {isPurchase && <th className="right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id}>
                <td>{m.code}</td>
                <td className="muted">{m.description}</td>
                <td className="right mono">{m.currentRate ? `₹${m.currentRate.pricePerKg}` : <span className="muted">no rate</span>}</td>
                <td>{m.currentRate ? new Date(m.currentRate.validFrom).toLocaleDateString() : '-'}</td>
                <td>{m.currentRate?.isStale && <span className="badge pending">expired - using last rate</span>}</td>
                {isPurchase && (
                  <td className="right">
                    <button
                      className="btn small"
                      onClick={() => {
                        setRateForm({ materialId: m.id, code: m.code });
                        setPrice(m.currentRate?.pricePerKg ?? 0);
                      }}
                    >
                      Submit new rate
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {newMaterialForm && (
        <Modal title="New raw material" onClose={() => setNewMaterialForm(false)}>
          <div className="form-grid">
            <div className="field">
              <label>Code (yarn count/type)</label>
              <input value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} placeholder="e.g. 2/20s OE" />
            </div>
            <div className="field">
              <label>Description</label>
              <input value={materialDesc} onChange={(e) => setMaterialDesc(e.target.value)} placeholder="e.g. Ground yarn" />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setNewMaterialForm(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={addMaterial}>
              Save
            </button>
          </div>
        </Modal>
      )}

      {rateForm && (
        <Modal title={`New rate for ${rateForm.code}`} onClose={() => setRateForm(null)}>
          <div className="form-grid">
            <div className="field">
              <label>Price / kg (₹)</label>
              <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Valid from</label>
              <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>Valid to (optional)</label>
              <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setRateForm(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={submitRate}>
              Submit for approval
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
