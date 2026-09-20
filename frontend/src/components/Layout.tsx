import { Link, NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import type { Notification, Role } from '../types';

const NAV: { to: string; label: string; roles: Role[] }[] = [
  { to: '/', label: 'Dashboard', roles: ['ADMIN', 'SUPERVISOR', 'PURCHASE', 'MERCHANDISER'] },
  { to: '/quotes', label: 'Quotes', roles: ['ADMIN', 'SUPERVISOR', 'MERCHANDISER'] },
  { to: '/raw-materials', label: 'Raw Material Master', roles: ['ADMIN', 'SUPERVISOR', 'PURCHASE'] },
  { to: '/products', label: 'Product Master', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/customers', label: 'Customer Master', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/item-types', label: 'Item Types (Stitching/Packing)', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/processing-charges', label: 'Processing Charges', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/accessory-types', label: 'Accessory Types', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/exchange-rates', label: 'Exchange Rates', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/general-settings', label: 'General Mapping', roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/notifications', label: 'Notifications', roles: ['ADMIN', 'SUPERVISOR', 'PURCHASE', 'MERCHANDISER'] },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);

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
      <aside className="sidebar">
        <div className="brand">
          Terry Towel Costing
          <small>Adwaith Lakshmi Industries</small>
        </div>
        <nav>
          {NAV.filter((item) => item.roles.includes(user.role)).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
              {item.to === '/notifications' && unread > 0 ? ` (${unread})` : ''}
            </NavLink>
          ))}
        </nav>
        <div className="footer">
          {user.name} · {user.role}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, alignItems: 'flex-start' }}>
            <Link className="btn small" to="/change-password" style={{ whiteSpace: 'nowrap' }}>
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
          <h1>Terry Towel Costing</h1>
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
