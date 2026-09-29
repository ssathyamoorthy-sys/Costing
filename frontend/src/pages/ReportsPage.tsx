import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Customer, Product, RawMaterial } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';

const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', USD: '$', GBP: '£', EUR: '€' };
const sym = (c: string) => CURRENCY_SYMBOL[c] || '';
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const money = (v: number, c: string) => `${sym(c)}${v.toFixed(2)}`;
const dt = (v: string | null) => (v ? new Date(v).toLocaleString() : '-');

type ReportId =
  | 'pipeline-summary'
  | 'win-loss'
  | 'sales-by-customer'
  | 'sales-by-region'
  | 'margin-profitability'
  | 'price-erosion'
  | 'dbk-summary'
  | 'pricing-history'
  | 'current-pricing-by-customer'
  | 'locked-register'
  | 'approval-turnaround'
  | 'raw-material-history'
  | 'master-data';

const REPORTS: { id: ReportId; label: string; group: string }[] = [
  { id: 'pipeline-summary', label: 'Quote Pipeline Summary', group: 'Sales & Pipeline' },
  { id: 'win-loss', label: 'Win/Loss Analysis', group: 'Sales & Pipeline' },
  { id: 'sales-by-customer', label: 'Sales by Customer', group: 'Sales & Pipeline' },
  { id: 'sales-by-region', label: 'Sales by Region/Currency', group: 'Sales & Pipeline' },
  { id: 'margin-profitability', label: 'Margin & Profitability', group: 'Pricing & Margin' },
  { id: 'price-erosion', label: 'Price Negotiation / Erosion', group: 'Pricing & Margin' },
  { id: 'dbk-summary', label: 'Duty Drawback (DBK) Summary', group: 'Pricing & Margin' },
  { id: 'pricing-history', label: 'Pricing History (by Product)', group: 'Pricing & Margin' },
  { id: 'current-pricing-by-customer', label: 'Current Pricing by Customer', group: 'Pricing & Margin' },
  { id: 'locked-register', label: 'Locked Quotes Register', group: 'Operational' },
  { id: 'approval-turnaround', label: 'Approval Turnaround', group: 'Operational' },
  { id: 'raw-material-history', label: 'Raw Material Rate History', group: 'Operational' },
  { id: 'master-data', label: 'Master Data Export', group: 'Operational' },
];
const GROUPS = ['Sales & Pipeline', 'Pricing & Margin', 'Operational'];

function DateRangeFilter({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="tag-row" style={{ marginBottom: 12 }}>
      <div className="field">
        <label>From</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="field">
        <label>To</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
    </div>
  );
}

// --- 1. Pipeline summary ---
interface PipelineRow {
  status: string;
  currency: string;
  count: number;
  totalValue: number;
}
function PipelineSummaryReport() {
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    api.get<PipelineRow[]>(`/reports/pipeline-summary?${qs}`).then(setRows);
  }, [from, to]);
  return (
    <div>
      <DateRangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Currency</th>
            <th className="right">Count</th>
            <th className="right">Total Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.status.replace(/_/g, ' ')}</td>
              <td>{r.currency}</td>
              <td className="right mono">{r.count}</td>
              <td className="right mono">{money(r.totalValue, r.currency)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No quotes in range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- 2. Win/Loss ---
interface WinLossRow {
  status: string;
  currency: string;
  count: number;
  totalValue: number;
}
function WinLossReport() {
  const [data, setData] = useState<{ rows: WinLossRow[]; totalQuotes: number }>({ rows: [], totalQuotes: 0 });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    api.get<{ rows: WinLossRow[]; totalQuotes: number }>(`/reports/win-loss?${qs}`).then(setData);
  }, [from, to]);
  return (
    <div>
      <DateRangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <p className="muted" style={{ fontSize: 12 }}>Outcome date approximated from last update, since there's no separate "converted/lost at" timestamp.</p>
      <table>
        <thead>
          <tr>
            <th>Outcome</th>
            <th>Currency</th>
            <th className="right">Count</th>
            <th className="right">% of total</th>
            <th className="right">Total Value</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>
              <td>{r.status.replace(/_/g, ' ')}</td>
              <td>{r.currency}</td>
              <td className="right mono">{r.count}</td>
              <td className="right mono">{data.totalQuotes ? pct(r.count / data.totalQuotes) : '-'}</td>
              <td className="right mono">{money(r.totalValue, r.currency)}</td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No won/lost quotes in range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- 3. Sales by customer ---
interface SalesByCustomerRow {
  customerId: number;
  customerName: string;
  region: string;
  currency: string;
  quoteCount: number;
  quotedValue: number;
  convertedCount: number;
  convertedValue: number;
  winRate: number;
}
function SalesByCustomerReport() {
  const [rows, setRows] = useState<SalesByCustomerRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    api.get<SalesByCustomerRow[]>(`/reports/sales-by-customer?${qs}`).then(setRows);
  }, [from, to]);
  return (
    <div>
      <DateRangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Region</th>
            <th className="right">Quotes</th>
            <th className="right">Quoted Value</th>
            <th className="right">Converted</th>
            <th className="right">Converted Value</th>
            <th className="right">Win Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customerId}>
              <td>{r.customerName}</td>
              <td>{r.region}</td>
              <td className="right mono">{r.quoteCount}</td>
              <td className="right mono">{money(r.quotedValue, r.currency)}</td>
              <td className="right mono">{r.convertedCount}</td>
              <td className="right mono">{money(r.convertedValue, r.currency)}</td>
              <td className="right mono">{pct(r.winRate)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No quotes in range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- 4. Sales by region ---
interface SalesByRegionRow {
  region: string;
  currency: string;
  count: number;
  quotedValue: number;
  convertedValue: number;
}
function SalesByRegionReport() {
  const [rows, setRows] = useState<SalesByRegionRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    api.get<SalesByRegionRow[]>(`/reports/sales-by-region?${qs}`).then(setRows);
  }, [from, to]);
  return (
    <div>
      <DateRangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <table>
        <thead>
          <tr>
            <th>Region</th>
            <th>Currency</th>
            <th className="right">Quotes</th>
            <th className="right">Quoted Value</th>
            <th className="right">Converted Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.region}</td>
              <td>{r.currency}</td>
              <td className="right mono">{r.count}</td>
              <td className="right mono">{money(r.quotedValue, r.currency)}</td>
              <td className="right mono">{money(r.convertedValue, r.currency)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No quotes in range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- 5. Margin & profitability ---
interface MarginRow {
  label: string;
  currency: string;
  itemCount: number;
  avgMarginPct: number;
  avgEffectiveMarginPctInclDbk: number;
  totalProfit: number;
}
function MarginProfitabilityReport() {
  const [rows, setRows] = useState<MarginRow[]>([]);
  const [groupBy, setGroupBy] = useState<'customer' | 'product'>('customer');
  useEffect(() => {
    api.get<MarginRow[]>(`/reports/margin-profitability?groupBy=${groupBy}`).then(setRows);
  }, [groupBy]);
  return (
    <div>
      <div className="tag-row" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Group by</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'customer' | 'product')}>
            <option value="customer">Customer</option>
            <option value="product">Product</option>
          </select>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{groupBy === 'customer' ? 'Customer' : 'Product'}</th>
            <th className="right">Items</th>
            <th className="right">Avg Margin %</th>
            <th className="right">Avg Margin % incl. DBK</th>
            <th className="right">Total Profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.label}</td>
              <td className="right mono">{r.itemCount}</td>
              <td className="right mono">{pct(r.avgMarginPct)}</td>
              <td className="right mono">{pct(r.avgEffectiveMarginPctInclDbk)}</td>
              <td className="right mono">{money(r.totalProfit, r.currency)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No priced items yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- 6. Price erosion ---
interface ErosionRow {
  quoteId: number;
  quoteNo: string;
  customerName: string;
  currency: string;
  status: string;
  locked: boolean;
  firstQuotedValue: number;
  currentValue: number;
  dropPct: number;
}
function PriceErosionReport() {
  const [rows, setRows] = useState<ErosionRow[]>([]);
  useEffect(() => {
    api.get<ErosionRow[]>('/reports/price-erosion').then(setRows);
  }, []);
  return (
    <div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Only quotes with at least one negotiation round (a price change after being quoted) appear here.
      </p>
      <table>
        <thead>
          <tr>
            <th>Quote No</th>
            <th>Customer</th>
            <th>Status</th>
            <th className="right">First Quoted</th>
            <th className="right">Current</th>
            <th className="right">Drop %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.quoteId}>
              <td className="mono">{r.quoteNo}</td>
              <td>{r.customerName}</td>
              <td>
                {r.status.replace(/_/g, ' ')}
                {r.locked ? ' (locked)' : ''}
              </td>
              <td className="right mono">{money(r.firstQuotedValue, r.currency)}</td>
              <td className="right mono">{money(r.currentValue, r.currency)}</td>
              <td className="right mono">{pct(r.dropPct)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No quotes have been renegotiated yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- 7. DBK summary ---
interface DbkRow {
  hsCode: string;
  description: string;
  currency: string;
  itemCount: number;
  totalIncentiveValue: number;
}
function DbkSummaryReport() {
  const [rows, setRows] = useState<DbkRow[]>([]);
  useEffect(() => {
    api.get<DbkRow[]>('/reports/dbk-summary').then(setRows);
  }, []);
  return (
    <table>
      <thead>
        <tr>
          <th>HS Code</th>
          <th>Description</th>
          <th className="right">Items</th>
          <th className="right">Total Incentive Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="mono">{r.hsCode}</td>
            <td>{r.description}</td>
            <td className="right mono">{r.itemCount}</td>
            <td className="right mono">{money(r.totalIncentiveValue, r.currency)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={4} className="muted">
              No items with an HSN code chosen yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// --- 8. Locked register ---
interface LockedRow {
  quoteId: number;
  finalReferenceNo: string;
  quoteNo: string;
  customerName: string;
  lockedBy: string;
  lockedAt: string;
  status: string;
  currency: string;
  finalValue: number;
}
function LockedRegisterReport() {
  const [rows, setRows] = useState<LockedRow[]>([]);
  useEffect(() => {
    api.get<LockedRow[]>('/reports/locked-register').then(setRows);
  }, []);
  return (
    <table>
      <thead>
        <tr>
          <th>Reference #</th>
          <th>Quote No</th>
          <th>Customer</th>
          <th>Locked By</th>
          <th>Locked At</th>
          <th>Status</th>
          <th className="right">Final Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.quoteId}>
            <td className="mono">{r.finalReferenceNo}</td>
            <td className="mono">{r.quoteNo}</td>
            <td>{r.customerName}</td>
            <td>{r.lockedBy}</td>
            <td>{dt(r.lockedAt)}</td>
            <td>{r.status.replace(/_/g, ' ')}</td>
            <td className="right mono">{money(r.finalValue, r.currency)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="muted">
              No quotes locked yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// --- 9. Approval turnaround ---
interface TurnaroundRow {
  merchandiserName: string;
  count: number;
  avgTurnaroundHours: number;
}
function ApprovalTurnaroundReport() {
  const [rows, setRows] = useState<TurnaroundRow[]>([]);
  useEffect(() => {
    api.get<TurnaroundRow[]>('/reports/approval-turnaround').then(setRows);
  }, []);
  return (
    <table>
      <thead>
        <tr>
          <th>Merchandiser</th>
          <th className="right">Quotes</th>
          <th className="right">Avg Turnaround (hrs)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.merchandiserName}</td>
            <td className="right mono">{r.count}</td>
            <td className="right mono">{r.avgTurnaroundHours.toFixed(1)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} className="muted">
              No quotes have been submitted and approved yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// --- 10. Raw material rate history ---
interface RateHistoryRow {
  materialCode: string;
  pricePerKg: number;
  validFrom: string;
  validTo: string | null;
  status: string;
  enteredBy: string;
  approvedBy: string;
}
function RawMaterialHistoryReport() {
  const [rows, setRows] = useState<RateHistoryRow[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [materialId, setMaterialId] = useState('');
  useEffect(() => {
    api.get<RawMaterial[]>('/raw-materials').then(setMaterials);
  }, []);
  useEffect(() => {
    const qs = materialId ? `?rawMaterialId=${materialId}` : '';
    api.get<RateHistoryRow[]>(`/reports/raw-material-history${qs}`).then(setRows);
  }, [materialId]);
  return (
    <div>
      <div className="field" style={{ maxWidth: 260, marginBottom: 12 }}>
        <label>Material</label>
        <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
          <option value="">All materials</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code}
            </option>
          ))}
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th>Material</th>
            <th className="right">Rate/Kg</th>
            <th>Valid From</th>
            <th>Valid To</th>
            <th>Status</th>
            <th>Entered By</th>
            <th>Approved By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="mono">{r.materialCode}</td>
              <td className="right mono">₹{r.pricePerKg.toFixed(2)}</td>
              <td>{new Date(r.validFrom).toLocaleDateString()}</td>
              <td>{r.validTo ? new Date(r.validTo).toLocaleDateString() : '-'}</td>
              <td>{r.status}</td>
              <td>{r.enteredBy}</td>
              <td>{r.approvedBy}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No rates on file.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- 11. Master data export ---
function MasterDataReport() {
  const [which, setWhich] = useState<'customers' | 'products' | 'raw-materials'>('customers');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api.get<any[]>(`/${which}`).then(setRows);
  }, [which]);

  const columns: Record<string, { key: string; label: string }[]> = {
    customers: [
      { key: 'name', label: 'Name' },
      { key: 'region', label: 'Region' },
      { key: 'countries', label: 'Countries' },
      { key: 'currency', label: 'Currency' },
      { key: 'paymentTerms', label: 'Payment Terms' },
    ],
    products: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'weavingWastagePct', label: 'Weaving Wastage %' },
      { key: 'rejectionPct', label: 'Rejection %' },
      { key: 'active', label: 'Active' },
    ],
    'raw-materials': [
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Description' },
    ],
  };
  const cols = columns[which];

  return (
    <div>
      <div className="field" style={{ maxWidth: 260, marginBottom: 12 }}>
        <label>Master</label>
        <select value={which} onChange={(e) => setWhich(e.target.value as any)}>
          <option value="customers">Customers</option>
          <option value="products">Products</option>
          <option value="raw-materials">Raw Materials</option>
        </select>
      </div>
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {cols.map((c) => (
                <td key={c.key}>{String(r[c.key] ?? '-')}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="muted">
                Nothing on file.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- 12. Pricing history by product ---
interface PricingHistoryRow {
  date: string;
  quoteNo: string;
  customerName: string;
  itemType: string;
  size: string;
  color: string;
  currency: string;
  ratePerPiece: number | null;
  ratePerKg: number | null;
  fxRate: number | null;
}
function PricingHistoryReport() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState<PricingHistoryRow[]>([]);
  useEffect(() => {
    api.get<Product[]>('/products').then(setProducts);
  }, []);
  useEffect(() => {
    if (!productId) {
      setRows([]);
      return;
    }
    api.get<PricingHistoryRow[]>(`/reports/pricing-history?productId=${productId}`).then(setRows);
  }, [productId]);

  return (
    <div>
      <div className="field" style={{ maxWidth: 300, marginBottom: 12 }}>
        <label>Product</label>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Select a product...</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code}
              {p.name ? ` - ${p.name}` : ''}
            </option>
          ))}
        </select>
      </div>
      {productId && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Quote No</th>
              <th>Customer</th>
              <th>Item</th>
              <th>Size</th>
              <th>Color</th>
              <th className="right">Rate/Pc</th>
              <th className="right">Rate/Kg</th>
              <th>Currency</th>
              <th className="right">FX Rate (INR/unit)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{new Date(r.date).toLocaleDateString()}</td>
                <td className="mono">{r.quoteNo}</td>
                <td>{r.customerName}</td>
                <td>{r.itemType}</td>
                <td>{r.size}</td>
                <td>{r.color}</td>
                <td className="right mono">{r.ratePerPiece != null ? r.ratePerPiece.toFixed(4) : '-'}</td>
                <td className="right mono">{r.ratePerKg != null ? r.ratePerKg.toFixed(4) : '-'}</td>
                <td>{r.currency}</td>
                <td className="right mono">{r.fxRate != null ? r.fxRate.toFixed(4) : '-'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  No quoted history for this product yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// --- 13. Current pricing by customer ---
interface CurrentPricingRow {
  customerName: string;
  productLabel: string;
  itemType: string;
  size: string;
  gsm: number;
  color: string;
  currency: string;
  ratePerPiece: number | null;
  ratePerKg: number | null;
  quoteNo: string;
  asOf: string;
}
function CurrentPricingByCustomerReport() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [rows, setRows] = useState<CurrentPricingRow[]>([]);
  useEffect(() => {
    api.get<Customer[]>('/customers').then(setCustomers);
  }, []);
  useEffect(() => {
    const qs = customerId ? `?customerId=${customerId}` : '';
    api.get<CurrentPricingRow[]>(`/reports/current-pricing-by-customer${qs}`).then(setRows);
  }, [customerId]);

  return (
    <div>
      <div className="field" style={{ maxWidth: 260, marginBottom: 12 }}>
        <label>Customer</label>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Product</th>
            <th>Item</th>
            <th>Size</th>
            <th className="right">GSM</th>
            <th>Color</th>
            <th className="right">Rate/Pc</th>
            <th className="right">Rate/Kg</th>
            <th>As of Quote</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.customerName}</td>
              <td>{r.productLabel}</td>
              <td>{r.itemType}</td>
              <td>{r.size}</td>
              <td className="right mono">{r.gsm}</td>
              <td>{r.color}</td>
              <td className="right mono">{r.ratePerPiece != null ? `${sym(r.currency)}${r.ratePerPiece.toFixed(4)}` : '-'}</td>
              <td className="right mono">{r.ratePerKg != null ? `${sym(r.currency)}${r.ratePerKg.toFixed(4)}` : '-'}</td>
              <td>
                {r.quoteNo} ({new Date(r.asOf).toLocaleDateString()})
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="muted">
                No quoted pricing yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReportBody({ id }: { id: ReportId }) {
  switch (id) {
    case 'pipeline-summary':
      return <PipelineSummaryReport />;
    case 'win-loss':
      return <WinLossReport />;
    case 'sales-by-customer':
      return <SalesByCustomerReport />;
    case 'sales-by-region':
      return <SalesByRegionReport />;
    case 'margin-profitability':
      return <MarginProfitabilityReport />;
    case 'price-erosion':
      return <PriceErosionReport />;
    case 'dbk-summary':
      return <DbkSummaryReport />;
    case 'pricing-history':
      return <PricingHistoryReport />;
    case 'current-pricing-by-customer':
      return <CurrentPricingByCustomerReport />;
    case 'locked-register':
      return <LockedRegisterReport />;
    case 'approval-turnaround':
      return <ApprovalTurnaroundReport />;
    case 'raw-material-history':
      return <RawMaterialHistoryReport />;
    case 'master-data':
      return <MasterDataReport />;
  }
}

export function ReportsPage() {
  const { user } = useAuth();
  const [active, setActive] = useState<ReportId>('pipeline-summary');
  const activeMeta = REPORTS.find((r) => r.id === active)!;

  if (user?.role !== 'SUPERVISOR' && user?.role !== 'ADMIN') {
    return <Alert type="error">Reports are only available to Supervisor and Admin.</Alert>;
  }

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <div className="panel" style={{ width: 260, flexShrink: 0, padding: 12 }}>
        {GROUPS.map((group) => (
          <div key={group} style={{ marginBottom: 14 }}>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', margin: '4px 8px' }}>
              {group}
            </div>
            {REPORTS.filter((r) => r.group === group).map((r) => (
              <button
                key={r.id}
                className="btn small"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: 4,
                  background: active === r.id ? 'var(--blue-light)' : undefined,
                  borderColor: active === r.id ? 'var(--blue)' : undefined,
                }}
                onClick={() => setActive(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{activeMeta.label}</h2>
          <ReportBody id={active} />
        </div>
      </div>
    </div>
  );
}
