import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { AccessoryType, ItemType, Product, RawMaterial } from '../types';
import { Alert } from '../components/Alert';

interface YarnRow {
  slot: string;
  rawMaterialId: number;
  mixingPct: number;
}
interface AccessoryRow {
  accessoryTypeId: number;
  costPerPiece: number;
}

export function ProductEditPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();

  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [accessoryTypes, setAccessoryTypes] = useState<AccessoryType[]>([]);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [itemTypeId, setItemTypeId] = useState<number | ''>('');
  const [fields, setFields] = useState({
    weavingWastagePct: 2.5,
    weavingSizingCostPerKg: 45,
    firstVelourCharges: 0,
    firstVelourLossPct: 0,
    secondVelourCharges: 0,
    secondVelourLossPct: 0,
    weightLossPct: 8,
    transportLocalPerKg: 3,
    rejectionPct: 3,
  });
  const [yarnRows, setYarnRows] = useState<YarnRow[]>([
    { slot: 'Ground', rawMaterialId: 0, mixingPct: 20 },
    { slot: 'Pile', rawMaterialId: 0, mixingPct: 60 },
    { slot: 'Weft', rawMaterialId: 0, mixingPct: 17 },
    { slot: 'Scoured', rawMaterialId: 0, mixingPct: 3 },
  ]);
  const [accessoryRows, setAccessoryRows] = useState<AccessoryRow[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    api.get<ItemType[]>('/item-types').then(setItemTypes);
    api.get<RawMaterial[]>('/raw-materials').then(setRawMaterials);
    api.get<AccessoryType[]>('/accessory-types').then(setAccessoryTypes);
  }, []);

  useEffect(() => {
    if (isNew) return;
    api.get<Product>(`/products/${id}`).then((p) => {
      setCode(p.code);
      setName(p.name || '');
      setItemTypeId(p.itemTypeId);
      setFields({
        weavingWastagePct: p.weavingWastagePct * 100,
        weavingSizingCostPerKg: p.weavingSizingCostPerKg,
        firstVelourCharges: p.firstVelourCharges,
        firstVelourLossPct: p.firstVelourLossPct * 100,
        secondVelourCharges: p.secondVelourCharges,
        secondVelourLossPct: p.secondVelourLossPct * 100,
        weightLossPct: p.weightLossPct * 100,
        transportLocalPerKg: p.transportLocalPerKg,
        rejectionPct: p.rejectionPct * 100,
      });
      setYarnRows(p.yarnComponents.map((c) => ({ slot: c.slot, rawMaterialId: c.rawMaterialId, mixingPct: c.mixingPct })));
      setAccessoryRows(p.accessories.map((a) => ({ accessoryTypeId: a.accessoryTypeId, costPerPiece: a.costPerPiece })));
    });
  }, [id, isNew]);

  const mixingTotal = yarnRows.reduce((s, r) => s + (Number(r.mixingPct) || 0), 0);

  function updateYarnRow(i: number, patch: Partial<YarnRow>) {
    setYarnRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addYarnRow() {
    setYarnRows((rows) => [...rows, { slot: '', rawMaterialId: 0, mixingPct: 0 }]);
  }
  function removeYarnRow(i: number) {
    setYarnRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  function addAccessoryRow() {
    setAccessoryRows((rows) => [...rows, { accessoryTypeId: accessoryTypes[0]?.id ?? 0, costPerPiece: 0 }]);
  }
  function updateAccessoryRow(i: number, patch: Partial<AccessoryRow>) {
    setAccessoryRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeAccessoryRow(i: number) {
    setAccessoryRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function save(force = false) {
    setError(null);
    setWarning(null);
    if (!itemTypeId) {
      setError('Select an item type');
      return;
    }
    const payload = {
      code,
      name: name || undefined,
      itemTypeId,
      weavingWastagePct: fields.weavingWastagePct / 100,
      weavingSizingCostPerKg: fields.weavingSizingCostPerKg,
      firstVelourCharges: fields.firstVelourCharges,
      firstVelourLossPct: fields.firstVelourLossPct / 100,
      secondVelourCharges: fields.secondVelourCharges,
      secondVelourLossPct: fields.secondVelourLossPct / 100,
      weightLossPct: fields.weightLossPct / 100,
      transportLocalPerKg: fields.transportLocalPerKg,
      rejectionPct: fields.rejectionPct / 100,
      yarnComponents: yarnRows.map((r) => ({ ...r, mixingPct: Number(r.mixingPct) })),
      force,
    };

    try {
      let productId = id ? Number(id) : undefined;
      if (isNew) {
        const created = await api.post<Product>('/products', payload);
        productId = created.id;
      } else {
        await api.put(`/products/${id}`, payload);
      }
      if (productId) {
        await api.put(`/products/${productId}/accessories`, accessoryRows);
      }
      navigate('/products');
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && (e.body as any)?.warning) {
        setWarning((e.body as any).warning + ' Click "Save anyway" to confirm.');
      } else {
        setError(e instanceof ApiError ? e.message : String(e));
      }
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>{isNew ? 'New product' : `Edit product ${code}`}</h2>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {warning && <Alert type="warning">{warning}</Alert>}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Basics</h3>
        <div className="form-grid">
          <div className="field">
            <label>Code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. PDD" />
          </div>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Plain Dyed Dobby" />
          </div>
          <div className="field">
            <label>Item Type</label>
            <select value={itemTypeId} onChange={(e) => setItemTypeId(Number(e.target.value))}>
              <option value="">Select...</option>
              {itemTypes.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Process parameters</h3>
        <div className="form-grid">
          <div className="field">
            <label>Weaving wastage %</label>
            <input type="number" step="0.01" value={fields.weavingWastagePct} onChange={(e) => setFields({ ...fields, weavingWastagePct: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Weaving + sizing cost/kg (₹)</label>
            <input type="number" value={fields.weavingSizingCostPerKg} onChange={(e) => setFields({ ...fields, weavingSizingCostPerKg: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>First velour charges (₹/kg)</label>
            <input type="number" value={fields.firstVelourCharges} onChange={(e) => setFields({ ...fields, firstVelourCharges: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>First velour loss %</label>
            <input type="number" step="0.01" value={fields.firstVelourLossPct} onChange={(e) => setFields({ ...fields, firstVelourLossPct: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Weight loss %</label>
            <input type="number" step="0.01" value={fields.weightLossPct} onChange={(e) => setFields({ ...fields, weightLossPct: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Second velour charges (₹/kg)</label>
            <input type="number" value={fields.secondVelourCharges} onChange={(e) => setFields({ ...fields, secondVelourCharges: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Second velour loss %</label>
            <input type="number" step="0.01" value={fields.secondVelourLossPct} onChange={(e) => setFields({ ...fields, secondVelourLossPct: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Local transport (₹/kg)</label>
            <input type="number" value={fields.transportLocalPerKg} onChange={(e) => setFields({ ...fields, transportLocalPerKg: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Rejection %</label>
            <input type="number" step="0.01" value={fields.rejectionPct} onChange={(e) => setFields({ ...fields, rejectionPct: Number(e.target.value) })} />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>
            Yarn recipe{' '}
            <span className={Math.abs(mixingTotal - 100) > 0.5 ? 'badge rejected' : 'badge approved'} style={{ marginLeft: 8 }}>
              total {mixingTotal.toFixed(1)}%
            </span>
          </h3>
          <button className="btn small" onClick={addYarnRow}>
            + Add slot
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Slot</th>
              <th>Raw material</th>
              <th className="right">Mixing %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {yarnRows.map((row, i) => (
              <tr key={i}>
                <td>
                  <input value={row.slot} onChange={(e) => updateYarnRow(i, { slot: e.target.value })} style={{ width: 110 }} />
                </td>
                <td>
                  <select value={row.rawMaterialId} onChange={(e) => updateYarnRow(i, { rawMaterialId: Number(e.target.value) })}>
                    <option value={0}>Select...</option>
                    {rawMaterials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="right">
                  <input type="number" step="0.1" value={row.mixingPct} onChange={(e) => updateYarnRow(i, { mixingPct: Number(e.target.value) })} style={{ width: 80, textAlign: 'right' }} />
                </td>
                <td>
                  <button className="btn small danger" onClick={() => removeYarnRow(i)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>Default accessories (₹/piece)</h3>
          <button className="btn small" onClick={addAccessoryRow}>
            + Add accessory
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Accessory</th>
              <th className="right">Cost/piece</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accessoryRows.map((row, i) => (
              <tr key={i}>
                <td>
                  <select value={row.accessoryTypeId} onChange={(e) => updateAccessoryRow(i, { accessoryTypeId: Number(e.target.value) })}>
                    {accessoryTypes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="right">
                  <input type="number" step="0.1" value={row.costPerPiece} onChange={(e) => updateAccessoryRow(i, { costPerPiece: Number(e.target.value) })} style={{ width: 80, textAlign: 'right' }} />
                </td>
                <td>
                  <button className="btn small danger" onClick={() => removeAccessoryRow(i)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tag-row">
        <button className="btn" onClick={() => navigate('/products')}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => save(false)}>
          Save
        </button>
        {warning && (
          <button className="btn danger" onClick={() => save(true)}>
            Save anyway
          </button>
        )}
      </div>
    </div>
  );
}
