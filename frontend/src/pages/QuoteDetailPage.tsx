import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, openBinary } from '../api';
import type { CostingBreakup, ItemType, Product, ProcessingCharge, Quote, QuoteLine } from '../types';
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

export function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [colors, setColors] = useState<ProcessingCharge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [form, setForm] = useState({ productId: '', itemTypeId: '', color: '', lengthCm: '', widthCm: '', gsm: '', qtyPcs: '', targetPrice: '' });
  const [overrideForLine, setOverrideForLine] = useState<number | null>(null);
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
    api.get<ProcessingCharge[]>('/processing-charges').then(setColors);
  }, []);

  if (!quote) return error ? <Alert type="error">{error}</Alert> : <p className="muted">Loading...</p>;

  const isOwner = quote.createdById === user?.id;
  const isMerchandiser = user?.role === 'MERCHANDISER' || user?.role === 'ADMIN';
  const isSupervisor = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const canEditLines = (quote.status === 'DRAFT' && isOwner && isMerchandiser) || (isSupervisor && ['DRAFT', 'PENDING_APPROVAL'].includes(quote.status));
  const currencies = quote.currencies.split(',');

  async function addLine() {
    setError(null);
    try {
      const res = await api.post<{ line: QuoteLine; warnings: string[] }>(`/quotes/${quote!.id}/lines`, {
        productId: Number(form.productId),
        itemTypeId: Number(form.itemTypeId),
        color: form.color,
        lengthCm: Number(form.lengthCm),
        widthCm: Number(form.widthCm),
        gsm: Number(form.gsm),
        qtyPcs: Number(form.qtyPcs),
        targetPrice: form.targetPrice ? Number(form.targetPrice) : undefined,
      });
      setWarnings(res.warnings);
      setForm({ productId: '', itemTypeId: '', color: '', lengthCm: '', widthCm: '', gsm: '', qtyPcs: '', targetPrice: '' });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function removeLine(lineId: number) {
    if (!confirm('Remove this line?')) return;
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

  async function submitOverride(lineId: number) {
    if (!overrideMaterialId || !overridePrice) return;
    try {
      await api.post(`/quotes/${quote!.id}/lines/${lineId}/material-override`, {
        rawMaterialId: overrideMaterialId,
        overridePricePerKg: Number(overridePrice),
        reason: overrideReason || undefined,
      });
      setOverrideForLine(null);
      setOverrideMaterialId('');
      setOverridePrice('');
      setOverrideReason('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
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

      {quote.lines.map((line) => {
        const breakup: CostingBreakup | null = line.costBreakupJson ? JSON.parse(line.costBreakupJson) : null;
        const isExpanded = expanded[line.id];
        return (
          <div className="line-card" key={line.id}>
            <div className="line-head">
              <div>
                <strong>{line.product.code}</strong> - {line.itemType?.name} - {line.color} - {line.lengthCm}x{line.widthCm}cm, GSM {line.gsm} - Qty {line.qtyPcs} pcs
                {line.pieceWeightGrams && <span className="muted"> ({line.pieceWeightGrams.toFixed(0)}g/pc, {line.qtyKg?.toFixed(1)} kg total)</span>}
              </div>
              <div className="tag-row">
                {isSupervisor && (
                  <button className="btn small" onClick={() => setExpanded((e) => ({ ...e, [line.id]: !e[line.id] }))}>
                    {isExpanded ? 'Hide' : 'Show'} cost breakup
                  </button>
                )}
                {canEditLines && (
                  <button className="btn small danger" onClick={() => removeLine(line.id)}>
                    Remove
                  </button>
                )}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th></th>
                  {currencies.map((c) => (
                    <th key={c} className="right">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Rate / Kg</td>
                  {currencies.map((c) => (
                    <td key={c} className="right mono">
                      {breakup?.ratePerKg?.[c] != null ? `${CURRENCY_SYMBOL[c] || ''}${breakup.ratePerKg[c].toFixed(4)}` : '-'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Rate / Piece</td>
                  {currencies.map((c) => (
                    <td key={c} className="right mono">
                      {breakup?.ratePerPiece?.[c] != null ? `${CURRENCY_SYMBOL[c] || ''}${breakup.ratePerPiece[c].toFixed(4)}` : '-'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>

            {isSupervisor && isExpanded && breakup && (
              <div style={{ marginTop: 14 }}>
                <table className="breakup-table">
                  <thead>
                    <tr>
                      <th>Cost stack (per kg, INR)</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakupRows.map((r) => (
                      <tr key={r.key}>
                        <td>{r.label}</td>
                        <td className="mono">₹{Number(breakup[r.key]).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {isSupervisor && (
                  <div style={{ marginTop: 14 }}>
                    <h4 style={{ margin: '0 0 8px' }}>Yarn components (raw material price used)</h4>
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
                        {line.product.yarnComponents.map((c) => {
                          const ov = line.materialOverrides.find((o) => o.rawMaterialId === c.rawMaterialId);
                          return (
                            <tr key={c.rawMaterialId}>
                              <td>{c.slot}</td>
                              <td>{c.rawMaterial?.code}</td>
                              <td className="right mono">{c.mixingPct}</td>
                              <td className="right mono">{ov ? `₹${ov.overridePricePerKg} (${ov.reason || 'override'})` : '-'}</td>
                              <td className="right">
                                <button
                                  className="btn small"
                                  onClick={() => {
                                    setOverrideForLine(line.id);
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

                    {overrideForLine === line.id && (
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
                          <button className="btn" onClick={() => setOverrideForLine(null)}>
                            Cancel
                          </button>
                          <button className="btn primary" onClick={() => submitOverride(line.id)}>
                            Apply override
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {quote.lines.length === 0 && <p className="muted">No lines yet.</p>}

      {canEditLines && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Add line</h3>
          <div className="form-grid">
            <div className="field">
              <label>Product (quality)</label>
              <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                <option value="">Select...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}{p.name ? ` - ${p.name}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Item Type</label>
              <select value={form.itemTypeId} onChange={(e) => setForm({ ...form, itemTypeId: e.target.value })}>
                <option value="">Select...</option>
                {itemTypes.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
            </div>
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
              <label>Length (cm)</label>
              <input type="number" value={form.lengthCm} onChange={(e) => setForm({ ...form, lengthCm: e.target.value })} />
            </div>
            <div className="field">
              <label>Width (cm)</label>
              <input type="number" value={form.widthCm} onChange={(e) => setForm({ ...form, widthCm: e.target.value })} />
            </div>
            <div className="field">
              <label>GSM</label>
              <input type="number" value={form.gsm} onChange={(e) => setForm({ ...form, gsm: e.target.value })} />
            </div>
            <div className="field">
              <label>Qty (pcs)</label>
              <input type="number" value={form.qtyPcs} onChange={(e) => setForm({ ...form, qtyPcs: e.target.value })} />
            </div>
            <div className="field">
              <label>Target price (optional)</label>
              <input type="number" value={form.targetPrice} onChange={(e) => setForm({ ...form, targetPrice: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button
              className="btn primary"
              onClick={addLine}
              disabled={!form.productId || !form.itemTypeId || !form.color || !form.lengthCm || !form.widthCm || !form.gsm || !form.qtyPcs}
            >
              Add line
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
