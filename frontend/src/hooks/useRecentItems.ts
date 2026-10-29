import { useCallback, useState } from 'react';

const MAX_RECENT = 5;

function storageKey(key: string) {
  return `ttc_recent_${key}`;
}

function readRecent(key: string): number[] {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

// Per-viewer "recently used" list (customers/products/raw materials/HSN codes a merchandiser
// keeps picking again) - localStorage only, never synced or read by the backend. Most-recent
// first, capped at 5. Wrapped in try/catch since storage can throw (private browsing, quota).
export function useRecentItems(key: string): [number[], (id: number) => void] {
  const [recent, setRecent] = useState<number[]>(() => readRecent(key));

  const push = useCallback(
    (id: number) => {
      setRecent((prev) => {
        const next = [id, ...prev.filter((v) => v !== id)].slice(0, MAX_RECENT);
        try {
          localStorage.setItem(storageKey(key), JSON.stringify(next));
        } catch {
          // ignore - keep working in-memory only
        }
        return next;
      });
    },
    [key],
  );

  return [recent, push];
}
