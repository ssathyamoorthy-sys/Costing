import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Product } from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';
import { ImportExportBar } from '../components/ImportExportBar';
import { SortableTh } from '../components/SortableTh';
import { useSortableTable } from '../hooks/useSortableTable';

export function ProductsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const [items, setItems] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  function load() {
    api.get<Product[]>('/products').then(setItems).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const filtered = items.filter((p) => {
    if (!filterText.trim()) return true;
    const needle = filterText.trim().toLowerCase();
    return p.code.toLowerCase().includes(needle) || (p.name ?? '').toLowerCase().includes(needle);
  });
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(filtered, {
    code: (p) => p.code,
    name: (p) => p.name ?? '',
    colorMethod: (p) => p.colorMethod,
    weavingWastagePct: (p) => p.weavingWastagePct,
    rejectionPct: (p) => p.rejectionPct,
  });

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
      <ImportExportBar
        exportUrl="/products/export.xlsx"
        exportFilename="products.xlsx"
        importUrl="/products/import"
        canEdit={canEdit}
        onImported={load}
      />
      <div className="tag-row" style={{ marginBottom: 14 }}>
        <input placeholder="Filter by code or name..." value={filterText} onChange={(e) => setFilterText(e.target.value)} style={{ minWidth: 260 }} />
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <SortableTh label="Code" sortKey="code" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Color method" sortKey="colorMethod" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <th>Yarn Recipe</th>
              <SortableTh label="Weaving Wastage %" sortKey="weavingWastagePct" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
              <SortableTh label="Rejection %" sortKey="rejectionPct" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="right" />
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.code}</strong>
                </td>
                <td className="muted">{p.name}</td>
                <td>
                  <span className={p.colorMethod === 'YARN_DYED' ? 'badge approved' : 'badge'}>
                    {p.colorMethod === 'YARN_DYED' ? 'Yarn dyed' : 'Piece dyed'}
                  </span>
                </td>
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
