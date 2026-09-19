import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Product } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';

export function ProductsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Product[]>('/products').then(setItems).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="toolbar">
        <h2>Product / Quality Master</h2>
        {canEdit && (
          <Link to="/products/new" className="btn primary">
            + Add product
          </Link>
        )}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Item Type</th>
              <th>Yarn Recipe</th>
              <th className="right">Weaving Wastage %</th>
              <th className="right">Rejection %</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.code}</strong>
                </td>
                <td className="muted">{p.name}</td>
                <td>{p.itemType?.name}</td>
                <td className="muted">
                  {p.yarnComponents.map((c) => `${c.slot} ${c.mixingPct}%`).join(', ')}
                </td>
                <td className="right mono">{(p.weavingWastagePct * 100).toFixed(2)}</td>
                <td className="right mono">{(p.rejectionPct * 100).toFixed(2)}</td>
                {canEdit && (
                  <td className="right">
                    <Link to={`/products/${p.id}`} className="btn small">
                      Edit
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
