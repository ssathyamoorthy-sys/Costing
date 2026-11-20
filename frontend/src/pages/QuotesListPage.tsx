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

const PAGE_SIZE = 20;

// A compact page-number bar: always shows the first and last page, a sliding window around the
// current page, and "…" where pages are skipped - rather than one button per page, which would
// get unwieldy once there are a few hundred quotes.
function pageWindow(current: number, total: number): (number | 'ellipsis')[] {
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: (number | 'ellipsis')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('ellipsis');
    result.push(sorted[i]);
  }
  return result;
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
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  function load() {
    api
      .get<Quote[]>('/quotes')
      .then(setQuotes)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
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
  // Reset to page 1 whenever the filtered/sorted set changes shape, so a filter that narrows
  // the list never leaves the view stranded on a now-empty page.
  useEffect(() => setPage(1), [filterText, filterStatus, sortKey, sortDir]);
  const totalPages = Math.max(1, Math.ceil(sortedQuotes.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedQuotes = sortedQuotes.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
      {loading ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
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
            {pagedQuotes.map((q) => (
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
      {sortedQuotes.length > 0 && (
        <div className="tag-row" style={{ marginTop: 10, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, sortedQuotes.length)} of{' '}
            {sortedQuotes.length}
          </span>
          {totalPages > 1 && (
            <>
              <button className="btn small" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                &laquo; Prev
              </button>
              {pageWindow(currentPage, totalPages).map((p, i) =>
                p === 'ellipsis' ? (
                  <span key={`e${i}`} className="muted">
                    …
                  </span>
                ) : (
                  <button key={p} className={`btn small ${p === currentPage ? 'primary' : ''}`} onClick={() => setPage(p)}>
                    {p}
                  </button>
                ),
              )}
              <button className="btn small" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
                Next &raquo;
              </button>
            </>
          )}
        </div>
      )}
        </>
      )}

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
