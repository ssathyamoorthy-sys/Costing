import type { SortDir } from '../hooks/useSortableTable';

export function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  dir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={className} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)}>
      {label}
      <span className="muted" style={{ marginLeft: 4 }}>
        {active ? (dir === 'asc' ? '▲' : '▼') : ''}
      </span>
    </th>
  );
}
