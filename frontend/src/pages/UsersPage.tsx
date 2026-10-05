import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import type { Role } from '../types';
import { Alert } from '../components/Alert';
import { Modal } from '../components/Modal';

interface ManagedUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  role: Role;
  active: boolean;
  createdAt: string;
}

const ROLES: Role[] = ['MERCHANDISER', 'PURCHASE', 'SUPERVISOR', 'ADMIN'];

export function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const isAdmin = me?.role === 'ADMIN';
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newForm, setNewForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('MERCHANDISER');
  const [newPassword, setNewPassword] = useState('');

  const [resetFor, setResetFor] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  function load() {
    if (!isAdmin) return;
    api.get<ManagedUser[]>('/users').then(setUsers).catch((e) => setError(e.message));
  }
  useEffect(load, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="panel">
        <p className="muted">This page is Admin-only.</p>
      </div>
    );
  }

  async function createUser() {
    try {
      await api.post('/users', { username: newUsername, name: newName, email: newEmail || undefined, role: newRole, password: newPassword });
      setNewForm(false);
      setNewUsername('');
      setNewName('');
      setNewEmail('');
      setNewRole('MERCHANDISER');
      setNewPassword('');
      setSuccess('User created.');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function updateRole(u: ManagedUser, role: Role) {
    try {
      await api.put(`/users/${u.id}`, { role });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function toggleActive(u: ManagedUser) {
    try {
      await api.put(`/users/${u.id}`, { active: !u.active });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function doResetPassword() {
    if (!resetFor) return;
    try {
      await api.post(`/users/${resetFor.id}/reset-password`, { newPassword: resetPassword });
      setSuccess(`Password reset for ${resetFor.username}.`);
      setResetFor(null);
      setResetPassword('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>User Rights</h2>
        <button className="btn primary" onClick={() => setNewForm(true)}>
          + Add user
        </button>
      </div>
      <p className="muted">Create accounts, change roles, deactivate access, and reset passwords.</p>
      {error && <Alert type="error">{error}</Alert>}
      {success && <Alert type="success">{success}</Alert>}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th className="right">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.name}</td>
                <td className="muted">{u.email || '-'}</td>
                <td>
                  <select value={u.role} onChange={(e) => updateRole(u, e.target.value as Role)} disabled={u.id === me?.id}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={`badge ${u.active ? 'approved' : 'rejected'}`}>{u.active ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="right">
                  <button className="btn small" style={{ marginRight: 6 }} onClick={() => setResetFor(u)}>
                    Reset password
                  </button>
                  <button className="btn small" disabled={u.id === me?.id} onClick={() => toggleActive(u)}>
                    {u.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {newForm && (
        <Modal title="New user" onClose={() => setNewForm(false)}>
          <div className="form-grid">
            <div className="field">
              <label>Username</label>
              <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. jsmith" />
            </div>
            <div className="field">
              <label>Full name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. John Smith" />
            </div>
            <div className="field">
              <label>Email (optional)</label>
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="e.g. jsmith@adwaithlakshmi.in" />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Temporary password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setNewForm(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={createUser}>
              Create
            </button>
          </div>
        </Modal>
      )}

      {resetFor && (
        <Modal title={`Reset password for ${resetFor.username}`} onClose={() => setResetFor(null)}>
          <div className="form-grid">
            <div className="field">
              <label>New password</label>
              <input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setResetFor(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={doResetPassword}>
              Reset
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
