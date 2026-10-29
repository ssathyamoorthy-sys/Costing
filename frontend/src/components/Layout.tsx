import { Link, NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import type { Notification, Role } from '../types';

const NAV: { to: string; label: string; roles: Role[] }[] = [
  { to: '/', label: 'Dashboard', roles: ['ADMIN', 'SUPERVISOR', 'PURCHASE', 'MERCHANDISER', 'FINANCE_MANAGER'] },
  { to: '/quotes', label: 'Quotes', roles: ['ADMIN', 'SUPERVISOR', 'MERCHANDISER', 'FINANCE_MANAGER'] },
  { to: '/templates', label: 'Quote Templates', roles: ['ADMIN', 'SUPERVISOR', 'MERCHANDISER'] },
  { to: '/raw-materials', label: 'Raw Material Master', roles: ['ADMIN', 'SUPERVISOR', 'PURCHASE'] },
  { to: '/products', label: 'Product Master', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/customers', label: 'Customer Master', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/item-types', label: 'Item Types (Stitching/Packing)', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/processing-charges', label: 'Processing Charges', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/accessory-types', label: 'Accessory Types', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/hsn-codes', label: 'HSN Master (DBK/ROSCTL)', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/exchange-rates', label: 'Exchange Rates', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/general-settings', label: 'General Mapping', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/users', label: 'User Rights', roles: ['ADMIN'] },
  { to: '/reports', label: 'Reports', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/notifications', label: 'Notifications', roles: ['ADMIN', 'SUPERVISOR', 'PURCHASE', 'MERCHANDISER', 'FINANCE_MANAGER'] },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    function poll() {
      api
        .get<Notification[]>('/notifications')
        .then((list) => {
          if (mounted) setUnread(list.filter((n) => !n.read).length);
        })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 30000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  if (!user) return null;

  return (
    <div className="app-shell">
      <div className={`sidebar-backdrop ${mobileNavOpen ? 'open' : ''}`} onClick={() => setMobileNavOpen(false)} />
      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="brand">
          <img src="/logo.jpg" alt="Adwaith Lakshmi Industries" className="brand-logo" />
          Terry Towel Costing
          <small>Adwaith Lakshmi Industries</small>
        </div>
        <nav>
          {NAV.filter((item) => item.roles.includes(user.role)).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setMobileNavOpen(false)}>
              {item.label}
              {item.to === '/notifications' && unread > 0 ? ` (${unread})` : ''}
            </NavLink>
          ))}
        </nav>
        <div className="footer">
          {user.name} · {user.role}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, alignItems: 'flex-start' }}>
            <Link className="btn small" to="/change-password" style={{ whiteSpace: 'nowrap' }} onClick={() => setMobileNavOpen(false)}>
              Change password
            </Link>
            <button className="btn small" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="hamburger-btn" aria-label="Toggle menu" onClick={() => setMobileNavOpen((o) => !o)}>
              ☰
            </button>
            <h1>Terry Towel Costing</h1>
          </div>
          <div className="user-chip">
            {unread > 0 && <span className="notif-dot" title={`${unread} unread notifications`} />}
            {user.username}
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
