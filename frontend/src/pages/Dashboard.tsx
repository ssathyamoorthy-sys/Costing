import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { Link } from 'react-router-dom';
import { api } from '../api';

const BLURBS: Record<string, { title: string; desc: string; links: { to: string; label: string }[] }> = {
  ADMIN: {
    title: 'Administrator',
    desc: 'Full access to all masters, quotes, and users.',
    links: [
      { to: '/quotes', label: 'View all quotes' },
      { to: '/raw-materials', label: 'Raw material master' },
      { to: '/products', label: 'Product master' },
    ],
  },
  SUPERVISOR: {
    title: 'Supervisor',
    desc: 'Maintain the product, customer, and general mapping masters, approve raw material rates, and approve or reject quotes submitted by merchandisers.',
    links: [
      { to: '/quotes', label: 'Review pending quotes' },
      { to: '/raw-materials', label: 'Approve raw material rates' },
      { to: '/products', label: 'Product master' },
    ],
  },
  PURCHASE: {
    title: 'Purchase',
    desc: 'Submit and update raw material (yarn) rates with a validity window. New rates need supervisor approval before quotes use them.',
    links: [{ to: '/raw-materials', label: 'Manage raw material rates' }],
  },
  MERCHANDISER: {
    title: 'Merchandiser',
    desc: 'Build customer quotes: pick a product and customer, enter size/GSM/qty, and get a live costed price in the customer’s own currency.',
    links: [{ to: '/quotes', label: 'Create a new quote' }],
  },
  FINANCE_MANAGER: {
    title: 'Finance Manager',
    desc: 'Review approved quotes (full cost and margin visibility), and lock & finalize a quote to generate its CVN once the Purchase Order is on file.',
    links: [{ to: '/quotes', label: 'View quotes' }],
  },
};

interface Counts {
  pendingQuotes: number;
  pendingRates: number;
  incompleteProducts: number;
}

export function Dashboard() {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Counts | null>(null);
  const canReview = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';

  useEffect(() => {
    if (!canReview) return;
    Promise.all([
      api.get<{ pendingApproval: number }>('/quotes/counts'),
      api.get<unknown[]>('/raw-materials/rates/pending'),
      api.get<{ count: number }>('/products/incomplete-count'),
    ])
      .then(([quoteCounts, pendingRates, productCounts]) => {
        setCounts({ pendingQuotes: quoteCounts.pendingApproval, pendingRates: pendingRates.length, incompleteProducts: productCounts.count });
      })
      .catch(() => {});
  }, [canReview]);

  if (!user) return null;
  const blurb = BLURBS[user.role];

  return (
    <div>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Welcome, {user.name}</h2>
        <p className="muted">{blurb.desc}</p>
        <div className="tag-row" style={{ marginTop: 16 }}>
          {blurb.links.map((l) => (
            <Link key={l.to} to={l.to} className="btn primary">
              {l.label}
            </Link>
          ))}
        </div>
      </div>

      {canReview && counts && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Needs your attention</h3>
          <div className="highlight-stats">
            <Link to="/quotes" className="stat-tile" style={{ textDecoration: 'none' }}>
              <div className="stat-label">Quotes pending approval</div>
              <div className="stat-value">{counts.pendingQuotes}</div>
            </Link>
            <Link to="/raw-materials" className="stat-tile" style={{ textDecoration: 'none' }}>
              <div className="stat-label">Raw material rates to approve</div>
              <div className="stat-value">{counts.pendingRates}</div>
            </Link>
            <Link to="/products" className="stat-tile" style={{ textDecoration: 'none' }}>
              <div className="stat-label">Products missing cost inputs</div>
              <div className="stat-value">{counts.incompleteProducts}</div>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
