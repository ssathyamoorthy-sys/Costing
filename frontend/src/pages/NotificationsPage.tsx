import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Notification } from '../types';

export function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);

  function load() {
    api.get<Notification[]>('/notifications').then(setItems);
  }
  useEffect(load, []);

  async function markRead(id: number) {
    await api.post(`/notifications/${id}/read`);
    load();
  }

  return (
    <div>
      <div className="toolbar">
        <h2>Notifications</h2>
      </div>
      <div className="panel">
        {items.length === 0 && <p className="muted">No notifications yet.</p>}
        {items.map((n) => (
          <div
            key={n.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
              opacity: n.read ? 0.6 : 1,
            }}
          >
            <div>
              <strong>{n.type}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                {n.message}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {new Date(n.createdAt).toLocaleString()} {n.emailSent && '· emailed'}
              </div>
            </div>
            {!n.read && (
              <button className="btn small" onClick={() => markRead(n.id)}>
                Mark read
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
