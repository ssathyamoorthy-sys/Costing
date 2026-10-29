import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Customer, ExtractionResult, Quote } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';
import { AiExtractModal } from '../components/AiExtractModal';
import { SearchableSelect } from '../components/SearchableSelect';
import { SortableTh } from '../components/SortableTh';
import { useRecentItems } from '../hooks/useRecentItems';
import { useSortableTable } from '../hooks/useSortableTable';

const STATUS_OPTIONS = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'CONVERTED_TO_ORDER', 'LOST_PRICE', 'LOST_MOQ', 'LOST_LEAD_TIME'];

function statusLabel(status: string) {
  switch (status) {
    case 'CONVERTED_TO_ORDER':
      return 'Converted to Order';
    case 'LOST_PRICE':
      return 'Lost - Price';
    case 'LOST_MOQ':
      return 'Lost - MOQ';
    case 'LOST_LEAD_TIME':
      return 'Lost - Lead Time';
    default:
      return status.replace(/_/g, ' ');
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'DRAFT':
      return 'draft';
    case 'PENDING_APPROVAL':
      return 'pending';
    case 'APPROVED':
    case 'CONVERTED_TO_ORDER':
      return 'approved';
    case 'REJECTED':
    case 'LOST_PRICE':
    case 'LOST_MOQ':
    case 'LOST_LEAD_TIME':
      return 'rejected';
    case 'SENT':
      return 'sent';
    default:
      return 'draft';
  }
}

export function QuotesListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [customerEnquiryNo, setCustomerEnquiryNo] = useState('');
  const [showAiExtract, setShowAiExtract] = useState(false);
  const [pendingAiExtraction, setPendingAiExtraction] = useState<ExtractionResult | null>(null);
  const [recentCustomers, pushRecentCustomer] = useRecentItems('customer');
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  function load() {
    api.get<Quote[]>('/quotes').then(setQuotes).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function openNew() {
    api.get<Customer[]>('/customers').then(setCustomers);
    setCustomerEnquiryNo('');
    setPendingAiExtraction(null);
    setCustomerId('');
    setShowNew(true);
  }

  function handleAiExtracted(result: ExtractionResult) {
    setShowAiExtract(false);
    setPendingAiExtraction(result);
    api.get<Customer[]>('/customers').then(setCustomers);
    setCustomerEnquiryNo('');
    setCustomerId(result.customer?.matchedId ?? '');
    setShowNew(true);
  }

  async function createQuote() {
    if (!customerId) return;
    try {
      const q = await api.post<Quote>('/quotes', { customerId, customerEnquiryNo: customerEnquiryNo || undefined });
      pushRecentCustomer(customerId);
      navigate(`/quotes/${q.id}`, { state: pendingAiExtraction ? { aiExtraction: pendingAiExtraction } : undefined });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const canCreate = user?.role === 'MERCHANDISER' || user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';

  const filteredQuotes = quotes.filter((q) => {
    if (filterStatus && q.status !== filterStatus) return false;
    if (!filterText.trim()) return true;
    const needle = filterText.trim().toLowerCase();
    return (
      q.quoteNo.toLowerCase().includes(needle) ||
      (q.customerEnquiryNo ?? '').toLowerCase().includes(needle) ||
      (q.customer?.name ?? '').toLowerCase().includes(needle)
    );
  });
  const { sorted: sortedQuotes, sortKey, sortDir, toggleSort } = useSortableTable(
    filteredQuotes,
    {
      quoteNo: (q) => q.quoteNo,
      customerEnquiryNo: (q) => q.customerEnquiryNo ?? '',
      customer: (q) => q.customer?.name ?? '',
      currency: (q) => q.currency,
      status: (q) => q.status,
      cvn: (q) => q.finalReferenceNo ?? '',
      lines: (q) => q.lines.length,
      createdBy: (q) => q.createdBy?.name ?? '',
      created: (q) => q.createdAt,
    },
    'created',
    'desc',
  );

  return (
    <div>
      <div className="toolbar">
        <h2>Quotes</h2>
        {canCreate && (
          <div className="tag-row">
            <button className="btn" onClick={() => setShowAiExtract(true)}>
              ✨ Create from file / email
            </button>
            <button className="btn primary" onClick={openNew}>
              + New quote
            </button>
          </div>
        )}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <div className="tag-row" style={{ marginBottom: 14 }}>
        <input
          placeholder="Filter by quote no, enquiry no, or customer..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        {(filterText || filterStatus) && (
          <button
            className="btn small"
            onClick={() => {
              setFilterText('');
              setFilterStatus('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <SortableTh label="Quote No" sortKey="quoteNo" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Customer Enquiry No" sortKey="customerEnquiryNo" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Customer" sortKey="customer" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Currency" sortKey="currency" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="CVN" sortKey="cvn" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Lines" sortKey="lines" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Created by" sortKey="createdBy" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Created" sortKey="created" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedQuotes.map((q) => (
              <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/quotes/${q.id}`)}>
                <td>
                  <Link to={`/quotes/${q.id}`} onClick={(e) => e.stopPropagation()}>
                    {q.quoteNo}
                  </Link>
                </td>
                <td className="muted">{q.customerEnquiryNo || '-'}</td>
                <td>{q.customer?.name}</td>
                <td className="muted">{q.currency}</td>
                <td>
                  <span className={`badge ${statusBadgeClass(q.status)}`}>{statusLabel(q.status)}</span>
                </td>
                <td className="mono muted">{q.finalReferenceNo || '-'}</td>
                <td>{q.lines.length}</td>
                <td className="muted">{q.createdBy?.name}</td>
                <td className="muted">{new Date(q.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && (
        <Modal title="New quote" onClose={() => setShowNew(false)}>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Customer</label>
              <SearchableSelect
                value={customerId}
                onChange={(v) => setCustomerId(v === '' ? '' : Number(v))}
                options={customers.map((c) => ({ value: c.id, label: c.name }))}
                recentValues={recentCustomers}
              />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Customer enquiry no. (optional)</label>
              <input
                value={customerEnquiryNo}
                onChange={(e) => setCustomerEnquiryNo(e.target.value)}
                placeholder="their RFQ / reference number"
              />
            </div>
            {customerId && (
              <p className="muted" style={{ gridColumn: '1 / -1', margin: 0 }}>
                This quote will be priced in{' '}
                <strong>{customers.find((c) => c.id === customerId)?.currency}</strong> - the customer's currency
                (set in the Customer Master).
              </p>
            )}
            {pendingAiExtraction && !customerId && (
              <p className="muted" style={{ gridColumn: '1 / -1', margin: 0 }}>
                AI read customer: "{pendingAiExtraction.customer?.guessedText || 'unknown'}" - no match found, please
                pick the closest one above.
              </p>
            )}
          </div>
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                setShowNew(false);
                setPendingAiExtraction(null);
              }}
            >
              Cancel
            </button>
            <button className="btn primary" onClick={createQuote} disabled={!customerId}>
              Create draft
            </button>
          </div>
        </Modal>
      )}

      {showAiExtract && <AiExtractModal onClose={() => setShowAiExtract(false)} onExtracted={handleAiExtracted} />}
    </div>
  );
}
