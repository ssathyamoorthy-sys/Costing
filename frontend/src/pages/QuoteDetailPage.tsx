import { Fragment, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, openBinary } from '../api';
import type { CostingBreakup, ItemType, Product, ProcessingCharge, Quote, QuoteLine, RawMaterial } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';

const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', USD: '$', GBP: '£', EUR: '€' };

function statusBadgeClass(status: string) {
  switch (status) {
    case 'DRAFT':
      return 'draft';
    case 'PENDING_APPROVAL':
      return 'pending';
    case 'APPROVED':
    case 'WON':
      return 'approved';
    case 'REJECTED':
    case 'LOST':
      return 'rejected';
    case 'SENT':
      return 'sent';
    default:
      return 'draft';
  }
}

const breakupRows: { key: keyof CostingBreakup; label: string }[] = [
  { key: 'yarnCostPerKg', label: 'Yarn cost (BOM, waste-adjusted)' },
  { key: 'weavingSizingCostPerKg', label: 'Weaving + sizing cost' },
  { key: 'firstVelourChargesPerKg', label: 'First velour charges' },
  { key: 'processingChargesPerKg', label: 'Processing charges (color)' },
  { key: 'secondVelourChargesPerKg', label: 'Second velour charges' },
  { key: 'transportLocalPerKg', label: 'Local transport' },
  { key: 'stitchingPackingPerKg', label: 'Stitching + packing + accessories' },
  { key: 'wcInterestPerKg', label: 'W.C. Interest (grossed up)' },
  { key: 'freightExportPerKg', label: 'Export freight' },
  { key: 'lcInterestPerKg', label: 'LC Interest (grossed up)' },
  { key: 'subtotalBeforeMargin', label: 'Subtotal before margin/commission' },
  { key: 'marginPerKg', label: 'Margin' },
  { key: 'commissionPerKg', label: 'Commission (grossed up)' },
  { key: 'finalPricePerKgInr', label: 'Final price / kg (INR)' },
];

interface FormYarnRow {
  slot: string;
  rawMaterialId: number | '';
  mixingPct: number;
}
interface FormPackagingCharge {
  description: string;
  ratePerPiece: string;
}
interface FormItem {
  itemTypeId: number | '';
  lengthCm: string;
  widthCm: string;
  gsm: string;
  qtyPerSet: string;
  packagingCharges: FormPackagingCharge[];
}
interface FormSegment {
  productId: number | '';
  yarnComponents: FormYarnRow[];
  items: FormItem[];
}
interface SetForm {
  color: string;
  qtySets: string;
  targetPrice: string;
  segments: FormSegment[];
}

function emptyItem(): FormItem {
  return { itemTypeId: '', lengthCm: '', widthCm: '', gsm: '', qtyPerSet: '1', packagingCharges: [] };
}
function emptySegment(): FormSegment {
  return { productId: '', yarnComponents: [], items: [emptyItem()] };
}
function emptySetForm(): SetForm {
  return { color: '', qtySets: '1', targetPrice: '', segments: [emptySegment()] };
}

export function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [colors, setColors] = useState<ProcessingCharge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [showForm, setShowForm] = useState(false);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [form, setForm] = useState<SetForm>(emptySetForm());
  const [mode, setMode] = useState<'single' | 'bundle'>('single');
  const [showYarnEditorSingle, setShowYarnEditorSingle] = useState(false);

  const [overrideForSegment, setOverrideForSegment] = useState<number | null>(null);
  const [overrideMaterialId, setOverrideMaterialId] = useState<number | ''>('');
  const [overridePrice, setOverridePrice] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  function load() {
    api
      .get<Quote>(`/quotes/${id}`)
      .then(setQuote)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [id]);
  useEffect(() => {
    api.get<Product[]>('/products').then(setProducts);
    api.get<ItemType[]>('/item-types').then(setItemTypes);
    api.get<RawMaterial[]>('/raw-materials').then(setRawMaterials);
    api.get<ProcessingCharge[]>('/processing-charges').then(setColors);
  }, []);

  if (!quote) return error ? <Alert type="error">{error}</Alert> : <p className="muted">Loading...</p>;

  const isOwner = quote.createdById === user?.id;
  const isMerchandiser = user?.role === 'MERCHANDISER' || user?.role === 'ADMIN';
  const isSupervisor = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const canEditLines = (quote.status === 'DRAFT' && isOwner && isMerchandiser) || (isSupervisor && ['DRAFT', 'PENDING_APPROVAL'].includes(quote.status));
  const currency = quote.currency;
  const symbol = CURRENCY_SYMBOL[currency] || '';

  // --- Set builder form helpers ---

  function startNewSet() {
    setEditingLineId(null);
    setForm(emptySetForm());
    setMode('single');
    setShowYarnEditorSingle(false);
    setShowForm(true);
  }

  function startEditSet(line: QuoteLine) {
    setEditingLineId(line.id);
    setForm({
      color: line.color,
      qtySets: String(line.qtySets),
      targetPrice: line.targetPrice != null ? String(line.targetPrice) : '',
      segments: line.segments.map((seg) => ({
        productId: seg.productId,
        yarnComponents: seg.yarnComponents.map((y) => ({ slot: y.slot, rawMaterialId: y.rawMaterialId, mixingPct: y.mixingPct })),
        items: seg.items.map((it) => ({
          itemTypeId: it.itemTypeId,
          lengthCm: String(it.lengthCm),
          widthCm: String(it.widthCm),
          gsm: String(it.gsm),
          qtyPerSet: String(it.qtyPerSet),
          packagingCharges: it.packagingCharges.map((p) => ({ description: p.description, ratePerPiece: String(p.ratePerPiece) })),
        })),
      })),
    });
    setMode(line.segments.length === 1 && line.segments[0].items.length === 1 ? 'single' : 'bundle');
    setShowYarnEditorSingle(false);
    setShowForm(true);
  }

  function canUseSingleMode(f: SetForm) {
    return f.segments.length === 1 && f.segments[0].items.length === 1;
  }
  function toSingleMode() {
    setForm((f) => {
      const totalQty = Math.round(Number(f.qtySets || 1) * Number(f.segments[0].items[0].qtyPerSet || 1));
      return {
        ...f,
        qtySets: String(totalQty),
        segments: [{ ...f.segments[0], items: [{ ...f.segments[0].items[0], qtyPerSet: '1' }] }],
      };
    });
    setMode('single');
  }

  function cancelForm() {
    setShowForm(false);
    setEditingLineId(null);
  }

  function addSegment() {
    setForm((f) => ({ ...f, segments: [...f.segments, emptySegment()] }));
  }
  function removeSegment(segIdx: number) {
    setForm((f) => ({ ...f, segments: f.segments.filter((_, i) => i !== segIdx) }));
  }
  function setSegmentProduct(segIdx: number, productId: number) {
    const product = products.find((p) => p.id === productId);
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) =>
        i === segIdx
          ? {
              ...seg,
              productId,
              yarnComponents: (product?.yarnComponents ?? []).map((c) => ({ slot: c.slot, rawMaterialId: c.rawMaterialId, mixingPct: c.mixingPct })),
            }
          : seg,
      ),
    }));
  }
  function addYarnRow(segIdx: number) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) => (i === segIdx ? { ...seg, yarnComponents: [...seg.yarnComponents, { slot: '', rawMaterialId: '', mixingPct: 0 }] } : seg)),
    }));
  }
  function updateYarnRow(segIdx: number, rowIdx: number, patch: Partial<FormYarnRow>) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) =>
        i === segIdx ? { ...seg, yarnComponents: seg.yarnComponents.map((r, ri) => (ri === rowIdx ? { ...r, ...patch } : r)) } : seg,
      ),
    }));
  }
  function removeYarnRow(segIdx: number, rowIdx: number) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) => (i === segIdx ? { ...seg, yarnComponents: seg.yarnComponents.filter((_, ri) => ri !== rowIdx) } : seg)),
    }));
  }
  function addItem(segIdx: number) {
    setForm((f) => ({ ...f, segments: f.segments.map((seg, i) => (i === segIdx ? { ...seg, items: [...seg.items, emptyItem()] } : seg)) }));
  }
  function removeItem(segIdx: number, itemIdx: number) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) => (i === segIdx ? { ...seg, items: seg.items.filter((_, ii) => ii !== itemIdx) } : seg)),
    }));
  }
  function updateItem(segIdx: number, itemIdx: number, patch: Partial<FormItem>) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) =>
        i === segIdx ? { ...seg, items: seg.items.map((it, ii) => (ii === itemIdx ? { ...it, ...patch } : it)) } : seg,
      ),
    }));
  }
  function addPackagingCharge(segIdx: number, itemIdx: number) {
    updateItem(segIdx, itemIdx, {
      packagingCharges: [...form.segments[segIdx].items[itemIdx].packagingCharges, { description: '', ratePerPiece: '' }],
    });
  }
  function updatePackagingCharge(segIdx: number, itemIdx: number, chargeIdx: number, patch: Partial<FormPackagingCharge>) {
    const item = form.segments[segIdx].items[itemIdx];
    updateItem(segIdx, itemIdx, {
      packagingCharges: item.packagingCharges.map((c, ci) => (ci === chargeIdx ? { ...c, ...patch } : c)),
    });
  }
  function removePackagingCharge(segIdx: number, itemIdx: number, chargeIdx: number) {
    const item = form.segments[segIdx].items[itemIdx];
    updateItem(segIdx, itemIdx, { packagingCharges: item.packagingCharges.filter((_, ci) => ci !== chargeIdx) });
  }

  function formIsValid() {
    if (!form.color || !form.qtySets) return false;
    for (const seg of form.segments) {
      if (!seg.productId || seg.yarnComponents.length === 0) return false;
      for (const y of seg.yarnComponents) {
        if (!y.rawMaterialId) return false;
      }
      if (seg.items.length === 0) return false;
      for (const it of seg.items) {
        if (!it.itemTypeId || !it.lengthCm || !it.widthCm || !it.gsm || !it.qtyPerSet) return false;
      }
    }
    return true;
  }

  function buildPayload() {
    return {
      color: form.color,
      qtySets: Number(form.qtySets),
      targetPrice: form.targetPrice ? Number(form.targetPrice) : undefined,
      segments: form.segments.map((seg) => ({
        productId: Number(seg.productId),
        yarnComponents: seg.yarnComponents.map((y) => ({ slot: y.slot, rawMaterialId: Number(y.rawMaterialId), mixingPct: Number(y.mixingPct) })),
        items: seg.items.map((it) => ({
          itemTypeId: Number(it.itemTypeId),
          lengthCm: Number(it.lengthCm),
          widthCm: Number(it.widthCm),
          gsm: Number(it.gsm),
          qtyPerSet: Number(it.qtyPerSet),
          packagingCharges: it.packagingCharges
            .filter((p) => p.description && p.ratePerPiece)
            .map((p) => ({ description: p.description, ratePerPiece: Number(p.ratePerPiece) })),
        })),
      })),
    };
  }

  async function submitSet() {
    setError(null);
    try {
      const payload = buildPayload();
      const res = editingLineId
        ? await api.put<{ line: QuoteLine; warnings: string[] }>(`/quotes/${quote!.id}/lines/${editingLineId}`, payload)
        : await api.post<{ line: QuoteLine; warnings: string[] }>(`/quotes/${quote!.id}/lines`, payload);
      setWarnings(res.warnings);
      setShowForm(false);
      setEditingLineId(null);
      setForm(emptySetForm());
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function removeLine(lineId: number) {
    if (!confirm('Remove this set?')) return;
    try {
      await api.del(`/quotes/${quote!.id}/lines/${lineId}`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function submitQuote() {
    try {
      await api.post(`/quotes/${quote!.id}/submit`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function approveQuote() {
    try {
      await api.post(`/quotes/${quote!.id}/approve`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function rejectQuote() {
    const remarks = prompt('Reason for rejecting this quote:') || undefined;
    try {
      await api.post(`/quotes/${quote!.id}/reject`, { remarks });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function markSent() {
    try {
      await api.post(`/quotes/${quote!.id}/mark-sent`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function setWonLost(status: 'WON' | 'LOST') {
    try {
      await api.post(`/quotes/${quote!.id}/status`, { status });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function submitOverride(segmentId: number) {
    if (!overrideMaterialId || !overridePrice) return;
    try {
      await api.post(`/quotes/${quote!.id}/segments/${segmentId}/material-override`, {
        rawMaterialId: overrideMaterialId,
        overridePricePerKg: Number(overridePrice),
        reason: overrideReason || undefined,
      });
      setOverrideForSegment(null);
      setOverrideMaterialId('');
      setOverridePrice('');
      setOverrideReason('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  function segmentMixingTotal(seg: FormSegment) {
    return seg.yarnComponents.reduce((s, r) => s + (Number(r.mixingPct) || 0), 0);
  }

  return (
    <div>
      <div className="toolbar">
        <h2>
          Quote {quote.quoteNo} <span className={`badge ${statusBadgeClass(quote.status)}`}>{quote.status.replace('_', ' ')}</span>
        </h2>
        <div className="tag-row">
          {quote.status === 'DRAFT' && isOwner && isMerchandiser && quote.lines.length > 0 && (
            <button className="btn primary" onClick={submitQuote}>
              Submit for approval
            </button>
          )}
          {quote.status === 'PENDING_APPROVAL' && isSupervisor && (
            <>
              <button className="btn success" onClick={approveQuote}>
                Approve
              </button>
              <button className="btn danger" onClick={rejectQuote}>
                Reject
              </button>
            </>
          )}
          {quote.status === 'APPROVED' && (
            <button className="btn primary" onClick={markSent}>
              Mark as sent to customer
            </button>
          )}
          {quote.status === 'SENT' && (
            <>
              <button className="btn success" onClick={() => setWonLost('WON')}>
                Mark Won
              </button>
              <button className="btn danger" onClick={() => setWonLost('LOST')}>
                Mark Lost
              </button>
            </>
          )}
          <button className="btn" onClick={() => openBinary(`/quotes/${quote.id}/pdf`, `${quote.quoteNo}.pdf`)}>
            Download PDF
          </button>
          <button className="btn" onClick={() => openBinary(`/quotes/${quote.id}/xlsx`, `${quote.quoteNo}.xlsx`)}>
            Download Excel
          </button>
          {isSupervisor && (
            <button
              className="btn"
              onClick={() => openBinary(`/quotes/${quote.id}/xlsx-detailed`, `${quote.quoteNo}-detailed.xlsx`)}
              title="Full cost build-up as live Excel formulas, one sheet per item"
            >
              Download Excel (with formulas)
            </button>
          )}
          <button className="btn" onClick={() => navigate('/quotes')}>
            Back to list
          </button>
        </div>
      </div>

      {error && <Alert type="error">{error}</Alert>}
      {warnings.map((w, i) => (
        <Alert key={i} type="warning">
          {w}
        </Alert>
      ))}
      {quote.remarks && <Alert type={quote.status === 'REJECTED' ? 'error' : 'success'}>Remarks: {quote.remarks}</Alert>}

      <div className="panel">
        <div className="form-grid">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Customer
            </div>
            <strong>{quote.customer?.name}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Payment Terms
            </div>
            {quote.paymentTerms || '-'}
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Freight Terms
            </div>
            {quote.freightTerms || '-'}
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Created by
            </div>
            {quote.createdBy?.name}
          </div>
        </div>
      </div>

      {quote.lines.map((line, lineIdx) => {
        const setRollup: { ratePerSet: Record<string, number> } | null = line.costBreakupJson ? JSON.parse(line.costBreakupJson) : null;
        const ratePerSet = setRollup?.ratePerSet?.[currency];
        const isExpanded = expanded[line.id];
        return (
          <div className="line-card" key={line.id}>
            <div className="line-head">
              <div>
                <strong>Set #{lineIdx + 1}</strong> - Color: {line.color} - {line.qtySets.toLocaleString()} set(s) ordered
                {line.segments.length > 1 && <span className="muted"> ({line.segments.length} segments, bundled)</span>}
              </div>
              <div className="tag-row">
                <button className="btn small" onClick={() => setExpanded((e) => ({ ...e, [line.id]: !e[line.id] }))}>
                  {isExpanded ? 'Hide' : 'Show'} details
                </button>
                {canEditLines && (
                  <>
                    <button className="btn small" onClick={() => startEditSet(line)}>
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => removeLine(line.id)}>
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th></th>
                  <th className="right">{currency}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Combined price / set</td>
                  <td className="right mono">{ratePerSet != null ? `${symbol}${ratePerSet.toFixed(4)}` : '-'}</td>
                </tr>
                <tr>
                  <td>Total for {line.qtySets} set(s)</td>
                  <td className="right mono">{ratePerSet != null ? `${symbol}${(ratePerSet * line.qtySets).toFixed(2)}` : '-'}</td>
                </tr>
              </tbody>
            </table>

            {isExpanded && (
              <div style={{ marginTop: 14 }}>
                {line.segments.map((seg) => {
                  const segLabel = seg.product?.name || seg.product?.code || `Product ${seg.productId}`;
                  return (
                    <div key={seg.id} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                      <h4 style={{ margin: '0 0 8px' }}>
                        Segment: {seg.product?.code} - {segLabel}
                      </h4>

                      <table>
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Size (cm)</th>
                            <th className="right">GSM</th>
                            <th className="right">Qty/Set</th>
                            <th className="right">Rate/Kg</th>
                            <th className="right">Rate/Pc</th>
                          </tr>
                        </thead>
                        <tbody>
                          {seg.items.map((item) => {
                            const b: CostingBreakup | null = item.costBreakupJson ? JSON.parse(item.costBreakupJson) : null;
                            return (
                              <Fragment key={item.id}>
                                <tr>
                                  <td>{item.itemType?.name}</td>
                                  <td>
                                    {item.lengthCm}x{item.widthCm}
                                  </td>
                                  <td className="right mono">{item.gsm}</td>
                                  <td className="right mono">{item.qtyPerSet}</td>
                                  <td className="right mono">{b?.ratePerKg?.[currency] != null ? `${symbol}${b.ratePerKg[currency].toFixed(4)}` : '-'}</td>
                                  <td className="right mono">{b?.ratePerPiece?.[currency] != null ? `${symbol}${b.ratePerPiece[currency].toFixed(4)}` : '-'}</td>
                                </tr>
                                {item.packagingCharges.length > 0 && (
                                  <tr>
                                    <td colSpan={6} className="muted" style={{ fontSize: 12 }}>
                                      + Packaging: {item.packagingCharges.map((p) => `${p.description} (₹${p.ratePerPiece}/pc)`).join(', ')}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>

                      {isSupervisor && (
                        <>
                          {seg.items.map((item) => {
                            const b: CostingBreakup | null = item.costBreakupJson ? JSON.parse(item.costBreakupJson) : null;
                            if (!b || !('yarnCostPerKg' in b)) return null;
                            return (
                              <table className="breakup-table" key={`bk-${item.id}`} style={{ marginTop: 8 }}>
                                <thead>
                                  <tr>
                                    <th>{item.itemType?.name} - cost stack (per kg, INR)</th>
                                    <th>Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {breakupRows.map((r) => (
                                    <tr key={r.key}>
                                      <td>{r.label}</td>
                                      <td className="mono">₹{Number(b[r.key]).toFixed(4)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })}

                          <div style={{ marginTop: 10 }}>
                            <h4 style={{ margin: '0 0 8px' }}>Yarn recipe (raw material price used)</h4>
                            <table>
                              <thead>
                                <tr>
                                  <th>Slot</th>
                                  <th>Material</th>
                                  <th className="right">Mixing %</th>
                                  <th className="right">Override</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {seg.yarnComponents.map((c) => {
                                  const ov = seg.materialOverrides?.find((o) => o.rawMaterialId === c.rawMaterialId);
                                  return (
                                    <tr key={c.id}>
                                      <td>{c.slot}</td>
                                      <td>{c.rawMaterial?.code}</td>
                                      <td className="right mono">{c.mixingPct}</td>
                                      <td className="right mono">{ov ? `₹${ov.overridePricePerKg} (${ov.reason || 'override'})` : '-'}</td>
                                      <td className="right">
                                        <button
                                          className="btn small"
                                          onClick={() => {
                                            setOverrideForSegment(seg.id!);
                                            setOverrideMaterialId(c.rawMaterialId);
                                            setOverridePrice(String(ov?.overridePricePerKg ?? ''));
                                          }}
                                        >
                                          Override price
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>

                            {overrideForSegment === seg.id && (
                              <div className="panel" style={{ marginTop: 10, background: 'var(--blue-light)' }}>
                                <div className="form-grid">
                                  <div className="field">
                                    <label>Override price / kg (₹)</label>
                                    <input type="number" value={overridePrice} onChange={(e) => setOverridePrice(e.target.value)} />
                                  </div>
                                  <div className="field">
                                    <label>Reason (notified to Purchase)</label>
                                    <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. bulk deal for this order" />
                                  </div>
                                </div>
                                <div className="modal-actions">
                                  <button className="btn" onClick={() => setOverrideForSegment(null)}>
                                    Cancel
                                  </button>
                                  <button className="btn primary" onClick={() => submitOverride(seg.id!)}>
                                    Apply override
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {quote.lines.length === 0 && <p className="muted">No lines yet.</p>}

      {canEditLines && !showForm && (
        <button className="btn primary" onClick={startNewSet}>
          + Add set
        </button>
      )}

      {canEditLines && showForm && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{editingLineId ? 'Edit set' : 'New set'}</h3>

          <div className="tag-row" style={{ marginBottom: 10 }}>
            <button className={`btn small ${mode === 'single' ? 'primary' : ''}`} onClick={toSingleMode} disabled={!canUseSingleMode(form)}>
              Single Product
            </button>
            <button className={`btn small ${mode === 'bundle' ? 'primary' : ''}`} onClick={() => setMode('bundle')}>
              Set / Bundle
            </button>
            {!canUseSingleMode(form) && mode === 'bundle' && (
              <span className="muted" style={{ fontSize: 12 }}>
                Remove extra segments/items to switch back to Single Product.
              </span>
            )}
          </div>
          {mode === 'bundle' && (
            <p className="muted" style={{ marginTop: -6 }}>
              For a bundled gift set (e.g. a bath towel + hand towel sold together at one combined price), add more
              than one segment below - each segment is one yarn quality, and can itself include more than one sized
              item sharing that yarn.
            </p>
          )}

          <div className="form-grid">
            <div className="field">
              <label>Color</label>
              <input list="colors" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              <datalist id="colors">
                {colors.map((c) => (
                  <option key={c.id} value={c.color} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>{mode === 'single' ? 'Qty (pcs)' : 'Sets ordered'}</label>
              <input type="number" value={form.qtySets} onChange={(e) => setForm({ ...form, qtySets: e.target.value })} />
            </div>
            <div className="field">
              <label>Target price (optional)</label>
              <input type="number" value={form.targetPrice} onChange={(e) => setForm({ ...form, targetPrice: e.target.value })} />
            </div>
          </div>

          {form.segments.map((seg, segIdx) => (
            <div key={segIdx} className="panel" style={{ marginTop: 14, background: 'var(--bg)' }}>
              {mode === 'bundle' && (
                <div className="toolbar">
                  <h4 style={{ margin: 0 }}>
                    Segment {segIdx + 1}{' '}
                    <span className={Math.abs(segmentMixingTotal(seg) - 100) > 0.5 ? 'badge rejected' : 'badge approved'}>
                      mixing {segmentMixingTotal(seg).toFixed(1)}%
                    </span>
                  </h4>
                  {form.segments.length > 1 && (
                    <button className="btn small danger" onClick={() => removeSegment(segIdx)}>
                      Remove segment
                    </button>
                  )}
                </div>
              )}

              <div className="field" style={{ maxWidth: 320 }}>
                <label>Product (quality)</label>
                <select value={seg.productId} onChange={(e) => setSegmentProduct(segIdx, Number(e.target.value))}>
                  <option value="">Select...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                      {p.name ? ` - ${p.name}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {mode === 'bundle' || showYarnEditorSingle ? (
                <div style={{ marginTop: 10 }}>
                  <div className="toolbar">
                    <strong style={{ fontSize: 13 }}>Yarn recipe</strong>
                    <div className="tag-row">
                      <button className="btn small" onClick={() => addYarnRow(segIdx)}>
                        + Add slot
                      </button>
                      {mode === 'single' && (
                        <button className="btn small" onClick={() => setShowYarnEditorSingle(false)}>
                          Hide
                        </button>
                      )}
                    </div>
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
                      {seg.yarnComponents.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          <td>
                            <input value={row.slot} onChange={(e) => updateYarnRow(segIdx, rowIdx, { slot: e.target.value })} style={{ width: 100 }} />
                          </td>
                          <td>
                            <select value={row.rawMaterialId} onChange={(e) => updateYarnRow(segIdx, rowIdx, { rawMaterialId: Number(e.target.value) })}>
                              <option value="">Select...</option>
                              {rawMaterials.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.code}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="right">
                            <input
                              type="number"
                              step="0.1"
                              value={row.mixingPct}
                              onChange={(e) => updateYarnRow(segIdx, rowIdx, { mixingPct: Number(e.target.value) })}
                              style={{ width: 70, textAlign: 'right' }}
                            />
                          </td>
                          <td>
                            <button className="btn small danger" onClick={() => removeYarnRow(segIdx, rowIdx)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <button className="btn small" onClick={() => setShowYarnEditorSingle(true)}>
                    Edit yarn recipe (advanced)
                  </button>
                </div>
              )}

              {mode === 'bundle' && (
                <div style={{ marginTop: 14 }}>
                  <div className="toolbar">
                    <strong style={{ fontSize: 13 }}>Items (from this segment's yarn)</strong>
                    <button className="btn small" onClick={() => addItem(segIdx)}>
                      + Add item
                    </button>
                  </div>
                </div>
              )}
              <div style={mode === 'single' ? { marginTop: 14 } : undefined}>
                {seg.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="panel" style={{ marginTop: 8 }}>
                    <div className="form-grid">
                      <div className="field">
                        <label>Item Type</label>
                        <select value={item.itemTypeId} onChange={(e) => updateItem(segIdx, itemIdx, { itemTypeId: Number(e.target.value) })}>
                          <option value="">Select...</option>
                          {itemTypes.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Length (cm)</label>
                        <input type="number" value={item.lengthCm} onChange={(e) => updateItem(segIdx, itemIdx, { lengthCm: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Width (cm)</label>
                        <input type="number" value={item.widthCm} onChange={(e) => updateItem(segIdx, itemIdx, { widthCm: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>GSM</label>
                        <input type="number" value={item.gsm} onChange={(e) => updateItem(segIdx, itemIdx, { gsm: e.target.value })} />
                      </div>
                      {mode === 'bundle' && (
                        <div className="field">
                          <label>Qty / Set</label>
                          <input type="number" value={item.qtyPerSet} onChange={(e) => updateItem(segIdx, itemIdx, { qtyPerSet: e.target.value })} />
                        </div>
                      )}
                      {seg.items.length > 1 && (
                        <div className="field" style={{ justifyContent: 'flex-end' }}>
                          <label>&nbsp;</label>
                          <button className="btn small danger" onClick={() => removeItem(segIdx, itemIdx)}>
                            Remove item
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div className="toolbar">
                        <span className="muted" style={{ fontSize: 12 }}>
                          Additional packaging charges (₹/pc)
                        </span>
                        <button className="btn small" onClick={() => addPackagingCharge(segIdx, itemIdx)}>
                          + Add charge
                        </button>
                      </div>
                      {item.packagingCharges.map((charge, chargeIdx) => (
                        <div key={chargeIdx} className="tag-row" style={{ marginTop: 4 }}>
                          <input
                            placeholder="Description, e.g. gift box"
                            value={charge.description}
                            onChange={(e) => updatePackagingCharge(segIdx, itemIdx, chargeIdx, { description: e.target.value })}
                            style={{ flex: 1 }}
                          />
                          <input
                            type="number"
                            placeholder="Rate/pc"
                            value={charge.ratePerPiece}
                            onChange={(e) => updatePackagingCharge(segIdx, itemIdx, chargeIdx, { ratePerPiece: e.target.value })}
                            style={{ width: 90 }}
                          />
                          <button className="btn small danger" onClick={() => removePackagingCharge(segIdx, itemIdx, chargeIdx)}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {mode === 'bundle' && (
            <div className="tag-row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={addSegment}>
                + Add segment (bundle in another item)
              </button>
            </div>
          )}

          <div className="tag-row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={cancelForm}>
              Cancel
            </button>
            <button className="btn primary" onClick={submitSet} disabled={!formIsValid()}>
              {editingLineId ? 'Save set' : 'Add set'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
