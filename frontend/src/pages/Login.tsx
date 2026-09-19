import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h2>Terry Towel Costing</h2>
        <p>Adwaith Lakshmi Industries Pvt. Ltd.</p>
        {error && <Alert type="error">{error}</Alert>}
        <form onSubmit={onSubmit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="field" style={{ marginBottom: 18 }}>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
