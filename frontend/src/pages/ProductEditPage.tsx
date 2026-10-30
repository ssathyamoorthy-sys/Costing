import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { AccessoryType, Product, RawMaterial } from '../types';
import { Alert } from '../components/Alert';
import { SearchableSelect } from '../components/SearchableSelect';
import { useRecentItems } from '../hooks/useRecentItems';

interface YarnRow {
  slot: string;
  rawMaterialId: number;
  mixingPct: number;
  dyeingCostPerKg: number;
  dyeVariant: string;
}
interface AccessoryRow {
  accessoryTypeId: number;
  costPerPiece: number;
}

export function ProductEditPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();

  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [accessoryTypes, setAccessoryTypes] = useState<AccessoryType[]>([]);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
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
    secondRejectionPct: 0,
    yarnDyeingProcessLossPct: 0,
    washingCostPerKg: 0,
    washingLossPct: 0,
  });
  const [colorMethod, setColorMethod] = useState<'PIECE_DYED' | 'YARN_DYED'>('PIECE_DYED');
  // Optional per-product override of the general "yarn-dyed MOQ (Kg)" setting (General
  // Mapping) - blank means "use the general default". String state since it's nullable, not
  // a plain number like the other process fields above.
  const [yarnDyedMoqKgOverride, setYarnDyedMoqKgOverride] = useState('');
  const [yarnRows, setYarnRows] = useState<YarnRow[]>([
    { slot: 'Ground', rawMaterialId: 0, mixingPct: 20, dyeingCostPerKg: 0, dyeVariant: '' },
    { slot: 'Pile', rawMaterialId: 0, mixingPct: 60, dyeingCostPerKg: 0, dyeVariant: '' },
    { slot: 'Weft', rawMaterialId: 0, mixingPct: 17, dyeingCostPerKg: 0, dyeVariant: '' },
    { slot: 'Scoured', rawMaterialId: 0, mixingPct: 3, dyeingCostPerKg: 0, dyeVariant: '' },
  ]);
  const [accessoryRows, setAccessoryRows] = useState<AccessoryRow[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    api.get<RawMaterial[]>('/raw-materials').then(setRawMaterials);
    api.get<AccessoryType[]>('/accessory-types').then(setAccessoryTypes);
  }, []);

  useEffect(() => {
    if (isNew) return;
    api.get<Product>(`/products/${id}`).then((p) => {
      setCode(p.code);
      setName(p.name || '');
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
        secondRejectionPct: (p.secondRejectionPct ?? 0) * 100,
        yarnDyeingProcessLossPct: (p.yarnDyeingProcessLossPct ?? 0) * 100,
        washingCostPerKg: p.washingCostPerKg ?? 0,
        washingLossPct: (p.washingLossPct ?? 0) * 100,
      });
      setColorMethod(p.colorMethod ?? 'PIECE_DYED');
      setYarnDyedMoqKgOverride(p.yarnDyedMoqKgOverride != null ? String(p.yarnDyedMoqKgOverride) : '');
      setYarnRows(
        p.yarnComponents.map((c) => ({
          slot: c.slot,
          rawMaterialId: c.rawMaterialId,
          mixingPct: c.mixingPct,
          dyeingCostPerKg: c.dyeingCostPerKg ?? 0,
          dyeVariant: c.dyeVariant ?? '',
        })),
      );
      setAccessoryRows(p.accessories.map((a) => ({ accessoryTypeId: a.accessoryTypeId, costPerPiece: a.costPerPiece })));
    });
  }, [id, isNew]);

  const mixingTotal = yarnRows.reduce((s, r) => s + (Number(r.mixingPct) || 0), 0);

  // A slot (e.g. "Pile") can be split across several rows with different dye variants/shades -
  // sums each slot's mixing % across all its rows, so the running subtotal can be shown once
  // per group (on its last row) instead of repeating a total that's only meaningful combined.
  function yarnSlotTotal(slot: string): number {
    const key = slot.trim().toLowerCase();
    return yarnRows.reduce((s, r) => (r.slot.trim().toLowerCase() === key ? s + (Number(r.mixingPct) || 0) : s), 0);
  }
  function isLastRowOfSlot(rowIdx: number): boolean {
    const key = yarnRows[rowIdx].slot.trim().toLowerCase();
    return !yarnRows.some((r, i) => i > rowIdx && r.slot.trim().toLowerCase() === key);
  }
  function yarnSlotRowCount(slot: string): number {
    const key = slot.trim().toLowerCase();
    return yarnRows.filter((r) => r.slot.trim().toLowerCase() === key).length;
  }

  const [recentRawMaterials, pushRecentRawMaterial] = useRecentItems('rawMaterial');
  function updateYarnRow(i: number, patch: Partial<YarnRow>) {
    if (patch.rawMaterialId) pushRecentRawMaterial(patch.rawMaterialId);
    setYarnRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addYarnRow() {
    setYarnRows((rows) => [...rows, { slot: '', rawMaterialId: 0, mixingPct: 0, dyeingCostPerKg: 0, dyeVariant: '' }]);
  }
  // Quick way to split a slot into another dye variant/shade without retyping the slot name.
  function addYarnVariant(afterRowIdx: number) {
    setYarnRows((rows) => {
      const slot = rows[afterRowIdx]?.slot ?? '';
      const next = [...rows];
      next.splice(afterRowIdx + 1, 0, { slot, rawMaterialId: 0, mixingPct: 0, dyeingCostPerKg: 0, dyeVariant: '' });
      return next;
    });
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
    const payload = {
      code,
      name: name || undefined,
      weavingWastagePct: fields.weavingWastagePct / 100,
      weavingSizingCostPerKg: fields.weavingSizingCostPerKg,
      firstVelourCharges: fields.firstVelourCharges,
      firstVelourLossPct: fields.firstVelourLossPct / 100,
      secondVelourCharges: fields.secondVelourCharges,
      secondVelourLossPct: fields.secondVelourLossPct / 100,
      weightLossPct: fields.weightLossPct / 100,
      transportLocalPerKg: fields.transportLocalPerKg,
      rejectionPct: fields.rejectionPct / 100,
      secondRejectionPct: fields.secondRejectionPct / 100,
      colorMethod,
      yarnDyedMoqKgOverride: yarnDyedMoqKgOverride.trim() ? Number(yarnDyedMoqKgOverride) : null,
      yarnDyeingProcessLossPct: fields.yarnDyeingProcessLossPct / 100,
      washingCostPerKg: fields.washingCostPerKg,
      washingLossPct: fields.washingLossPct / 100,
      yarnComponents: yarnRows.map((r) => ({
        ...r,
        mixingPct: Number(r.mixingPct),
        dyeingCostPerKg: Number(r.dyeingCostPerKg) || 0,
        dyeVariant: r.dyeVariant.trim() || undefined,
      })),
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
        </div>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          This quality can be used for any Item Type on a quote line (Bath Towel, Hand Towel, Bath Sheet, etc.) -
          the merchandiser picks the Item Type when adding it to a quote.
        </p>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Process parameters</h3>
        <div className="form-grid">
          <div className="field">
            <label>Color method</label>
            <select value={colorMethod} onChange={(e) => setColorMethod(e.target.value as 'PIECE_DYED' | 'YARN_DYED')}>
              <option value="PIECE_DYED">Piece dyed (dyed as fabric after weaving)</option>
              <option value="YARN_DYED">Yarn dyed (yarn dyed per-slot before weaving)</option>
            </select>
          </div>
          {colorMethod === 'YARN_DYED' && (
            <div className="field">
              <label>Yarn dyeing process loss %</label>
              <input
                type="number"
                step="0.01"
                value={fields.yarnDyeingProcessLossPct}
                onChange={(e) => setFields({ ...fields, yarnDyeingProcessLossPct: Number(e.target.value) })}
              />
            </div>
          )}
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
          {colorMethod === 'YARN_DYED' ? (
            <>
              <div className="field">
                <label>Washing cost/kg (₹)</label>
                <input type="number" value={fields.washingCostPerKg} onChange={(e) => setFields({ ...fields, washingCostPerKg: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label>Washing loss %</label>
                <input type="number" step="0.01" value={fields.washingLossPct} onChange={(e) => setFields({ ...fields, washingLossPct: Number(e.target.value) })} />
              </div>
            </>
          ) : (
            <div className="field">
              <label>Weight loss %</label>
              <input type="number" step="0.01" value={fields.weightLossPct} onChange={(e) => setFields({ ...fields, weightLossPct: Number(e.target.value) })} />
            </div>
          )}
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
          <div className="field">
            <label>Second rejection % (garment items only)</label>
            <input type="number" step="0.01" value={fields.secondRejectionPct} onChange={(e) => setFields({ ...fields, secondRejectionPct: Number(e.target.value) })} />
          </div>
          {colorMethod === 'YARN_DYED' && (
            <div className="field">
              <label>MOQ override (Kg, optional - blank uses the general default)</label>
              <input type="number" value={yarnDyedMoqKgOverride} onChange={(e) => setYarnDyedMoqKgOverride(e.target.value)} />
            </div>
          )}
        </div>
        {colorMethod === 'YARN_DYED' && (
          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Yarn-dyed products skip the flat Processing Charge (by color) entirely - each yarn slot below carries
            its own dyeing cost/kg instead, and washing (above) replaces the piece-dyed processing stage after weaving.
          </p>
        )}
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
              {colorMethod === 'YARN_DYED' && (
                <>
                  <th className="right">Dyeing cost/kg (₹)</th>
                  <th>Dye variant / shade</th>
                </>
              )}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {yarnRows.map((row, i) => {
              const groupSize = yarnSlotRowCount(row.slot);
              return (
                <tr key={i}>
                  <td>
                    <input value={row.slot} onChange={(e) => updateYarnRow(i, { slot: e.target.value })} style={{ width: 110 }} />
                  </td>
                  <td>
                    <SearchableSelect
                      value={row.rawMaterialId || ''}
                      onChange={(v) => updateYarnRow(i, { rawMaterialId: v === '' ? 0 : Number(v) })}
                      options={rawMaterials.map((m) => ({ value: m.id, label: m.code, sublabel: m.description ?? undefined }))}
                      recentValues={recentRawMaterials}
                      style={{ minWidth: 140 }}
                    />
                  </td>
                  <td className="right">
                    <input type="number" step="0.1" value={row.mixingPct} onChange={(e) => updateYarnRow(i, { mixingPct: Number(e.target.value) })} style={{ width: 80, textAlign: 'right' }} />
                    {groupSize > 1 && isLastRowOfSlot(i) && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        "{row.slot}" total: {yarnSlotTotal(row.slot).toFixed(1)}%
                      </div>
                    )}
                  </td>
                  {colorMethod === 'YARN_DYED' && (
                    <>
                      <td className="right">
                        <input
                          type="number"
                          step="0.1"
                          value={row.dyeingCostPerKg}
                          onChange={(e) => updateYarnRow(i, { dyeingCostPerKg: Number(e.target.value) })}
                          style={{ width: 90, textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <input
                          value={row.dyeVariant}
                          onChange={(e) => updateYarnRow(i, { dyeVariant: e.target.value })}
                          placeholder={row.dyeingCostPerKg ? 'e.g. VAT Dark' : 'White / Undyed'}
                          style={{ width: 120 }}
                        />
                      </td>
                    </>
                  )}
                  <td>
                    <div className="tag-row">
                      {colorMethod === 'YARN_DYED' && (
                        <button className="btn small" title="Split this slot into another dye variant" onClick={() => addYarnVariant(i)}>
                          + Variant
                        </button>
                      )}
                      <button className="btn small danger" onClick={() => removeYarnRow(i)}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
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
