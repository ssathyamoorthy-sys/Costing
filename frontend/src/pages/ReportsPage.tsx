import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Customer, Product, RawMaterial } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { SortableTh } from '../components/SortableTh';
import { useSortableTable } from '../hooks/useSortableTable';
import { exportRowsToCsv } from '../lib/exportCsv';

function ExportCsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn small" onClick={onClick}>
      Export CSV
    </button>
  );
}
function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

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
  | 'master-data'
  | 'change-log';

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
  { id: 'change-log', label: 'Master Data Change Log', group: 'Operational' },
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
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    setLoading(true);
    api.get<PipelineRow[]>(`/reports/pipeline-summary?${qs}`).then(setRows).finally(() => setLoading(false));
  }, [from, to]);
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    status: (r) => r.status,
    currency: (r) => r.currency,
    count: (r) => r.count,
    totalValue: (r) => r.totalValue,
  });
  function exportCsv() {
    exportRowsToCsv(
      `pipeline-summary-${todayStamp()}.csv`,
      [
        { key: 'status', label: 'Status' },
        { key: 'currency', label: 'Currency' },
        { key: 'count', label: 'Count' },
        { key: 'totalValue', label: 'Total Value' },
      ],
      sorted.map((r) => ({ status: r.status.replace(/_/g, ' '), currency: r.currency, count: r.count, totalValue: money(r.totalValue, r.currency) })),
    );
  }
  return (
    <div>
      <DateRangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {loading ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Currency" sortKey="currency" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Count" sortKey="count" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Total Value" sortKey="totalValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
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
        </>
      )}
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
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    setLoading(true);
    api.get<{ rows: WinLossRow[]; totalQuotes: number }>(`/reports/win-loss?${qs}`).then(setData).finally(() => setLoading(false));
  }, [from, to]);
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(data.rows, {
    status: (r) => r.status,
    currency: (r) => r.currency,
    count: (r) => r.count,
    pctOfTotal: (r) => (data.totalQuotes ? r.count / data.totalQuotes : 0),
    totalValue: (r) => r.totalValue,
  });
  function exportCsv() {
    exportRowsToCsv(
      `win-loss-${todayStamp()}.csv`,
      [
        { key: 'status', label: 'Outcome' },
        { key: 'currency', label: 'Currency' },
        { key: 'count', label: 'Count' },
        { key: 'pctOfTotal', label: '% of total' },
        { key: 'totalValue', label: 'Total Value' },
      ],
      sorted.map((r) => ({
        status: r.status.replace(/_/g, ' '),
        currency: r.currency,
        count: r.count,
        pctOfTotal: data.totalQuotes ? pct(r.count / data.totalQuotes) : '-',
        totalValue: money(r.totalValue, r.currency),
      })),
    );
  }
  return (
    <div>
      <DateRangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <p className="muted" style={{ fontSize: 12 }}>Outcome date approximated from last update, since there's no separate "converted/lost at" timestamp.</p>
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="Outcome" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Currency" sortKey="currency" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Count" sortKey="count" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="% of total" sortKey="pctOfTotal" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Total Value" sortKey="totalValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
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
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    customerName: (r) => r.customerName,
    region: (r) => r.region,
    quoteCount: (r) => r.quoteCount,
    quotedValue: (r) => r.quotedValue,
    convertedCount: (r) => r.convertedCount,
    convertedValue: (r) => r.convertedValue,
    winRate: (r) => r.winRate,
  });
  function exportCsv() {
    exportRowsToCsv(
      `sales-by-customer-${todayStamp()}.csv`,
      [
        { key: 'customerName', label: 'Customer' },
        { key: 'region', label: 'Region' },
        { key: 'quoteCount', label: 'Quotes' },
        { key: 'quotedValue', label: 'Quoted Value' },
        { key: 'convertedCount', label: 'Converted' },
        { key: 'convertedValue', label: 'Converted Value' },
        { key: 'winRate', label: 'Win Rate' },
      ],
      sorted.map((r) => ({
        customerName: r.customerName,
        region: r.region,
        quoteCount: r.quoteCount,
        quotedValue: money(r.quotedValue, r.currency),
        convertedCount: r.convertedCount,
        convertedValue: money(r.convertedValue, r.currency),
        winRate: pct(r.winRate),
      })),
    );
  }
  return (
    <div>
      <DateRangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="Customer" sortKey="customerName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Region" sortKey="region" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Quotes" sortKey="quoteCount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Quoted Value" sortKey="quotedValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Converted" sortKey="convertedCount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Converted Value" sortKey="convertedValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Win Rate" sortKey="winRate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
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
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    region: (r) => r.region,
    currency: (r) => r.currency,
    count: (r) => r.count,
    quotedValue: (r) => r.quotedValue,
    convertedValue: (r) => r.convertedValue,
  });
  function exportCsv() {
    exportRowsToCsv(
      `sales-by-region-${todayStamp()}.csv`,
      [
        { key: 'region', label: 'Region' },
        { key: 'currency', label: 'Currency' },
        { key: 'count', label: 'Quotes' },
        { key: 'quotedValue', label: 'Quoted Value' },
        { key: 'convertedValue', label: 'Converted Value' },
      ],
      sorted.map((r) => ({
        region: r.region,
        currency: r.currency,
        count: r.count,
        quotedValue: money(r.quotedValue, r.currency),
        convertedValue: money(r.convertedValue, r.currency),
      })),
    );
  }
  return (
    <div>
      <DateRangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="Region" sortKey="region" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Currency" sortKey="currency" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Quotes" sortKey="count" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Quoted Value" sortKey="quotedValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Converted Value" sortKey="convertedValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
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
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    label: (r) => r.label,
    itemCount: (r) => r.itemCount,
    avgMarginPct: (r) => r.avgMarginPct,
    avgEffectiveMarginPctInclDbk: (r) => r.avgEffectiveMarginPctInclDbk,
    totalProfit: (r) => r.totalProfit,
  });
  function exportCsv() {
    exportRowsToCsv(
      `margin-profitability-${todayStamp()}.csv`,
      [
        { key: 'label', label: groupBy === 'customer' ? 'Customer' : 'Product' },
        { key: 'itemCount', label: 'Items' },
        { key: 'avgMarginPct', label: 'Avg Margin %' },
        { key: 'avgEffectiveMarginPctInclDbk', label: 'Avg Margin % incl. DBK' },
        { key: 'totalProfit', label: 'Total Profit' },
      ],
      sorted.map((r) => ({
        label: r.label,
        itemCount: r.itemCount,
        avgMarginPct: pct(r.avgMarginPct),
        avgEffectiveMarginPctInclDbk: pct(r.avgEffectiveMarginPctInclDbk),
        totalProfit: money(r.totalProfit, r.currency),
      })),
    );
  }
  return (
    <div>
      <div className="tag-row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <div className="field">
          <label>Group by</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'customer' | 'product')}>
            <option value="customer">Customer</option>
            <option value="product">Product</option>
          </select>
        </div>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label={groupBy === 'customer' ? 'Customer' : 'Product'} sortKey="label" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Items" sortKey="itemCount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Avg Margin %" sortKey="avgMarginPct" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh
              label="Avg Margin % incl. DBK"
              sortKey="avgEffectiveMarginPctInclDbk"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              className="right"
            />
            <SortableTh label="Total Profit" sortKey="totalProfit" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
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
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    quoteNo: (r) => r.quoteNo,
    customerName: (r) => r.customerName,
    status: (r) => r.status,
    firstQuotedValue: (r) => r.firstQuotedValue,
    currentValue: (r) => r.currentValue,
    dropPct: (r) => r.dropPct,
  });
  function exportCsv() {
    exportRowsToCsv(
      `price-erosion-${todayStamp()}.csv`,
      [
        { key: 'quoteNo', label: 'Quote No' },
        { key: 'customerName', label: 'Customer' },
        { key: 'status', label: 'Status' },
        { key: 'firstQuotedValue', label: 'First Quoted' },
        { key: 'currentValue', label: 'Current' },
        { key: 'dropPct', label: 'Drop %' },
      ],
      sorted.map((r) => ({
        quoteNo: r.quoteNo,
        customerName: r.customerName,
        status: r.status.replace(/_/g, ' ') + (r.locked ? ' (locked)' : ''),
        firstQuotedValue: money(r.firstQuotedValue, r.currency),
        currentValue: money(r.currentValue, r.currency),
        dropPct: pct(r.dropPct),
      })),
    );
  }
  return (
    <div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Only quotes with at least one negotiation round (a price change after being quoted) appear here.
      </p>
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="Quote No" sortKey="quoteNo" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Customer" sortKey="customerName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="First Quoted" sortKey="firstQuotedValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Current" sortKey="currentValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Drop %" sortKey="dropPct" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
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
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    hsCode: (r) => r.hsCode,
    description: (r) => r.description,
    itemCount: (r) => r.itemCount,
    totalIncentiveValue: (r) => r.totalIncentiveValue,
  });
  function exportCsv() {
    exportRowsToCsv(
      `dbk-summary-${todayStamp()}.csv`,
      [
        { key: 'hsCode', label: 'HS Code' },
        { key: 'description', label: 'Description' },
        { key: 'itemCount', label: 'Items' },
        { key: 'totalIncentiveValue', label: 'Total Incentive Value' },
      ],
      sorted.map((r) => ({ hsCode: r.hsCode, description: r.description, itemCount: r.itemCount, totalIncentiveValue: money(r.totalIncentiveValue, r.currency) })),
    );
  }
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="HS Code" sortKey="hsCode" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Description" sortKey="description" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Items" sortKey="itemCount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Total Incentive Value" sortKey="totalIncentiveValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
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
    </div>
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
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    finalReferenceNo: (r) => r.finalReferenceNo,
    quoteNo: (r) => r.quoteNo,
    customerName: (r) => r.customerName,
    lockedBy: (r) => r.lockedBy,
    lockedAt: (r) => r.lockedAt,
    status: (r) => r.status,
    finalValue: (r) => r.finalValue,
  });
  function exportCsv() {
    exportRowsToCsv(
      `locked-register-${todayStamp()}.csv`,
      [
        { key: 'finalReferenceNo', label: 'Reference #' },
        { key: 'quoteNo', label: 'Quote No' },
        { key: 'customerName', label: 'Customer' },
        { key: 'lockedBy', label: 'Locked By' },
        { key: 'lockedAt', label: 'Locked At' },
        { key: 'status', label: 'Status' },
        { key: 'finalValue', label: 'Final Value' },
      ],
      sorted.map((r) => ({
        finalReferenceNo: r.finalReferenceNo,
        quoteNo: r.quoteNo,
        customerName: r.customerName,
        lockedBy: r.lockedBy,
        lockedAt: dt(r.lockedAt),
        status: r.status.replace(/_/g, ' '),
        finalValue: money(r.finalValue, r.currency),
      })),
    );
  }
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="Reference #" sortKey="finalReferenceNo" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Quote No" sortKey="quoteNo" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Customer" sortKey="customerName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Locked By" sortKey="lockedBy" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Locked At" sortKey="lockedAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Final Value" sortKey="finalValue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
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
    </div>
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
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    merchandiserName: (r) => r.merchandiserName,
    count: (r) => r.count,
    avgTurnaroundHours: (r) => r.avgTurnaroundHours,
  });
  function exportCsv() {
    exportRowsToCsv(
      `approval-turnaround-${todayStamp()}.csv`,
      [
        { key: 'merchandiserName', label: 'Merchandiser' },
        { key: 'count', label: 'Quotes' },
        { key: 'avgTurnaroundHours', label: 'Avg Turnaround (hrs)' },
      ],
      sorted.map((r) => ({
        merchandiserName: r.merchandiserName,
        count: r.count,
        avgTurnaroundHours: r.avgTurnaroundHours.toFixed(1),
      })),
    );
  }
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="Merchandiser" sortKey="merchandiserName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Quotes" sortKey="count" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Avg Turnaround (hrs)" sortKey="avgTurnaroundHours" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
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
    </div>
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
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    materialCode: (r) => r.materialCode,
    pricePerKg: (r) => r.pricePerKg,
    validFrom: (r) => r.validFrom,
    validTo: (r) => r.validTo ?? '',
    status: (r) => r.status,
    enteredBy: (r) => r.enteredBy,
    approvedBy: (r) => r.approvedBy,
  });
  function exportCsv() {
    exportRowsToCsv(
      `raw-material-history-${todayStamp()}.csv`,
      [
        { key: 'materialCode', label: 'Material' },
        { key: 'pricePerKg', label: 'Rate/Kg' },
        { key: 'validFrom', label: 'Valid From' },
        { key: 'validTo', label: 'Valid To' },
        { key: 'status', label: 'Status' },
        { key: 'enteredBy', label: 'Entered By' },
        { key: 'approvedBy', label: 'Approved By' },
      ],
      sorted.map((r) => ({
        materialCode: r.materialCode,
        pricePerKg: `₹${r.pricePerKg.toFixed(2)}`,
        validFrom: new Date(r.validFrom).toLocaleDateString(),
        validTo: r.validTo ? new Date(r.validTo).toLocaleDateString() : '-',
        status: r.status,
        enteredBy: r.enteredBy,
        approvedBy: r.approvedBy,
      })),
    );
  }
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
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="Material" sortKey="materialCode" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Rate/Kg" sortKey="pricePerKg" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Valid From" sortKey="validFrom" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Valid To" sortKey="validTo" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Entered By" sortKey="enteredBy" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Approved By" sortKey="approvedBy" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
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
  const getters: Record<string, (r: any) => string | number> = {};
  for (const c of cols) getters[c.key] = (r: any) => r[c.key] ?? '';
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, getters);
  function exportCsv() {
    exportRowsToCsv(
      `${which}-${todayStamp()}.csv`,
      cols,
      sorted.map((r) => {
        const out: Record<string, unknown> = {};
        for (const c of cols) out[c.key] = String(r[c.key] ?? '-');
        return out;
      }),
    );
  }

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
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <SortableTh key={c.key} label={c.label} sortKey={c.key} activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
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

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    date: (r) => r.date,
    quoteNo: (r) => r.quoteNo,
    customerName: (r) => r.customerName,
    itemType: (r) => r.itemType,
    size: (r) => r.size,
    color: (r) => r.color,
    ratePerPiece: (r) => r.ratePerPiece ?? -1,
    ratePerKg: (r) => r.ratePerKg ?? -1,
    currency: (r) => r.currency,
    fxRate: (r) => r.fxRate ?? -1,
  });
  function exportCsv() {
    exportRowsToCsv(
      `pricing-history-${todayStamp()}.csv`,
      [
        { key: 'date', label: 'Date' },
        { key: 'quoteNo', label: 'Quote No' },
        { key: 'customerName', label: 'Customer' },
        { key: 'itemType', label: 'Item' },
        { key: 'size', label: 'Size' },
        { key: 'color', label: 'Color' },
        { key: 'ratePerPiece', label: 'Rate/Pc' },
        { key: 'ratePerKg', label: 'Rate/Kg' },
        { key: 'currency', label: 'Currency' },
        { key: 'fxRate', label: 'FX Rate (INR/unit)' },
      ],
      sorted.map((r) => ({
        date: new Date(r.date).toLocaleDateString(),
        quoteNo: r.quoteNo,
        customerName: r.customerName,
        itemType: r.itemType,
        size: r.size,
        color: r.color,
        ratePerPiece: r.ratePerPiece != null ? r.ratePerPiece.toFixed(4) : '-',
        ratePerKg: r.ratePerKg != null ? r.ratePerKg.toFixed(4) : '-',
        currency: r.currency,
        fxRate: r.fxRate != null ? r.fxRate.toFixed(4) : '-',
      })),
    );
  }

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
        <div>
          <div style={{ marginBottom: 12 }}>
            <ExportCsvButton onClick={exportCsv} />
          </div>
          <table>
            <thead>
              <tr>
                <SortableTh label="Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableTh label="Quote No" sortKey="quoteNo" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableTh label="Customer" sortKey="customerName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableTh label="Item" sortKey="itemType" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableTh label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableTh label="Color" sortKey="color" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableTh label="Rate/Pc" sortKey="ratePerPiece" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
                <SortableTh label="Rate/Kg" sortKey="ratePerKg" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
                <SortableTh label="Currency" sortKey="currency" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableTh label="FX Rate (INR/unit)" sortKey="fxRate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
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
        </div>
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

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    customerName: (r) => r.customerName,
    productLabel: (r) => r.productLabel,
    itemType: (r) => r.itemType,
    size: (r) => r.size,
    gsm: (r) => r.gsm,
    color: (r) => r.color,
    ratePerPiece: (r) => r.ratePerPiece ?? -1,
    ratePerKg: (r) => r.ratePerKg ?? -1,
    asOf: (r) => r.asOf,
  });
  function exportCsv() {
    exportRowsToCsv(
      `current-pricing-by-customer-${todayStamp()}.csv`,
      [
        { key: 'customerName', label: 'Customer' },
        { key: 'productLabel', label: 'Product' },
        { key: 'itemType', label: 'Item' },
        { key: 'size', label: 'Size' },
        { key: 'gsm', label: 'GSM' },
        { key: 'color', label: 'Color' },
        { key: 'ratePerPiece', label: 'Rate/Pc' },
        { key: 'ratePerKg', label: 'Rate/Kg' },
        { key: 'asOf', label: 'As of Quote' },
      ],
      sorted.map((r) => ({
        customerName: r.customerName,
        productLabel: r.productLabel,
        itemType: r.itemType,
        size: r.size,
        gsm: r.gsm,
        color: r.color,
        ratePerPiece: r.ratePerPiece != null ? `${sym(r.currency)}${r.ratePerPiece.toFixed(4)}` : '-',
        ratePerKg: r.ratePerKg != null ? `${sym(r.currency)}${r.ratePerKg.toFixed(4)}` : '-',
        asOf: `${r.quoteNo} (${new Date(r.asOf).toLocaleDateString()})`,
      })),
    );
  }

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
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="Customer" sortKey="customerName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Product" sortKey="productLabel" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Item" sortKey="itemType" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="GSM" sortKey="gsm" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Color" sortKey="color" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Rate/Pc" sortKey="ratePerPiece" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="Rate/Kg" sortKey="ratePerKg" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
            <SortableTh label="As of Quote" sortKey="asOf" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
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

// --- 14. Master data change log ---
const AUDIT_ENTITY_TYPES: { value: string; label: string }[] = [
  { value: 'Product', label: 'Product Master' },
  { value: 'Customer', label: 'Customer Master' },
  { value: 'ProcessingCharge', label: 'Processing Charges' },
  { value: 'HsnCode', label: 'HSN Master' },
  { value: 'ExchangeRate', label: 'Exchange Rates' },
  { value: 'GeneralSetting', label: 'General Mapping' },
];
interface ChangeLogRow {
  id: number;
  entityId: number;
  entityLabel: string;
  action: 'CREATE' | 'UPDATE';
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  changedBy: string;
  createdAt: string;
}
function formatChangeValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}
function ChangeLogReport() {
  const [entityType, setEntityType] = useState('Product');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<ChangeLogRow[]>([]);
  useEffect(() => {
    const qs = new URLSearchParams({ entityType });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    api.get<ChangeLogRow[]>(`/reports/change-log?${qs}`).then(setRows);
  }, [entityType, from, to]);

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(rows, {
    createdAt: (r) => r.createdAt,
    changedBy: (r) => r.changedBy,
    action: (r) => r.action,
    entityLabel: (r) => r.entityLabel,
  });
  function exportCsv() {
    exportRowsToCsv(
      `change-log-${todayStamp()}.csv`,
      [
        { key: 'createdAt', label: 'When' },
        { key: 'changedBy', label: 'Changed by' },
        { key: 'action', label: 'Action' },
        { key: 'entityLabel', label: 'Record' },
        { key: 'changes', label: 'Changes' },
      ],
      sorted.map((r) => ({
        createdAt: dt(r.createdAt),
        changedBy: r.changedBy,
        action: r.action === 'CREATE' ? 'Created' : 'Updated',
        entityLabel: r.entityLabel,
        changes:
          r.changes.length === 0
            ? '-'
            : r.changes.map((c) => `${c.field}: ${formatChangeValue(c.oldValue)} -> ${formatChangeValue(c.newValue)}`).join('; '),
      })),
    );
  }

  return (
    <div>
      <div className="tag-row" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ maxWidth: 260 }}>
          <label>Master</label>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            {AUDIT_ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <DateRangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <ExportCsvButton onClick={exportCsv} />
      </div>
      <table>
        <thead>
          <tr>
            <SortableTh label="When" sortKey="createdAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Changed by" sortKey="changedBy" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Action" sortKey="action" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortableTh label="Record" sortKey="entityLabel" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td className="muted">{dt(r.createdAt)}</td>
              <td>{r.changedBy}</td>
              <td>
                <span className={`badge ${r.action === 'CREATE' ? 'approved' : 'pending'}`}>{r.action === 'CREATE' ? 'Created' : 'Updated'}</span>
              </td>
              <td>{r.entityLabel}</td>
              <td style={{ fontSize: 12 }}>
                {r.changes.length === 0
                  ? '-'
                  : r.changes.map((c, i) => (
                      <div key={i}>
                        <strong>{c.field}</strong>: {formatChangeValue(c.oldValue)} → {formatChangeValue(c.newValue)}
                      </div>
                    ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No changes logged for this master in range.
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
    case 'change-log':
      return <ChangeLogReport />;
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
