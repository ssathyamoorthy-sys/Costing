import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Customer, Quote } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';

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

export function QuotesListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [currencies, setCurrencies] = useState<string[]>(['INR', 'USD', 'GBP']);

  function load() {
    api.get<Quote[]>('/quotes').then(setQuotes).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function openNew() {
    api.get<Customer[]>('/customers').then(setCustomers);
    setShowNew(true);
  }

  async function createQuote() {
    if (!customerId) return;
    try {
      const q = await api.post<Quote>('/quotes', { customerId, currencies });
      navigate(`/quotes/${q.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const canCreate = user?.role === 'MERCHANDISER' || user?.role === 'ADMIN';

  return (
    <div>
      <div className="toolbar">
        <h2>Quotes</h2>
        {canCreate && (
          <button className="btn primary" onClick={openNew}>
            + New quote
          </button>
        )}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Quote No</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Lines</th>
              <th>Created by</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/quotes/${q.id}`)}>
                <td>
                  <Link to={`/quotes/${q.id}`} onClick={(e) => e.stopPropagation()}>
                    {q.quoteNo}
                  </Link>
                </td>
                <td>{q.customer?.name}</td>
                <td>
                  <span className={`badge ${statusBadgeClass(q.status)}`}>{q.status.replace('_', ' ')}</span>
                </td>
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
              <select value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>
                <option value="">Select...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Currencies to quote in</label>
              <div className="tag-row">
                {['INR', 'USD', 'GBP', 'EUR'].map((cur) => (
                  <label key={cur} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={currencies.includes(cur)}
                      onChange={(e) =>
                        setCurrencies((prev) => (e.target.checked ? [...prev, cur] : prev.filter((c) => c !== cur)))
                      }
                    />
                    {cur}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setShowNew(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={createQuote} disabled={!customerId}>
              Create draft
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
