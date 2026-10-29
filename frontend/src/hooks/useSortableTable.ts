import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

// Generic click-to-sort for a plain array of rows. `getters` maps a sort key (matching the
// `sortKey` passed to SortableTh) to a function that pulls the comparable value out of a row.
export function useSortableTable<T>(
  rows: T[],
  getters: Record<string, (row: T) => string | number>,
  defaultKey?: string,
  defaultDir: SortDir = 'asc',
) {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const sorted = useMemo(() => {
    const getter = sortKey ? getters[sortKey] : undefined;
    if (!getter) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return { sorted, sortKey, sortDir, toggleSort };
}
