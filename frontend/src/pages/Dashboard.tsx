import { useAuth } from '../AuthContext';
import { Link } from 'react-router-dom';

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
    desc: 'Build customer quotes: pick a product and customer, enter size/GSM/qty, and get a live costed price in INR, USD, GBP and EUR.',
    links: [{ to: '/quotes', label: 'Create a new quote' }],
  },
};

export function Dashboard() {
  const { user } = useAuth();
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
    </div>
  );
}
