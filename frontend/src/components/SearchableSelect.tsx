import { useEffect, useRef, useState } from 'react';

export interface SearchableSelectOption {
  value: number;
  label: string;
  sublabel?: string;
}

// A type-to-filter dropdown, near-drop-in for a native <select value=... onChange=...>: pass
// `options` (value/label/sublabel), `value` (0 or '' means "nothing selected"), and `onChange`.
// Used for the master-data pickers that get long (Raw Material, Product, Customer, HSN Code) -
// plain <select>s stay in place everywhere else (short, fixed lists don't need this).
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled,
  style,
  recentValues,
}: {
  value: number | '';
  onChange: (value: number | '') => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  // Most-recent-first ids (see useRecentItems) - pinned at the top, under a "Recent" label,
  // only while the query is empty (typing searches everything, recency stops mattering).
  recentValues?: number[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const trimmedQuery = query.trim();
  const searched = trimmedQuery
    ? options.filter((o) => `${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : options;
  const recentOptions = !trimmedQuery && recentValues?.length
    ? (recentValues.map((id) => options.find((o) => o.value === id)).filter(Boolean) as SearchableSelectOption[])
    : [];
  const recentIds = new Set(recentOptions.map((o) => o.value));
  const otherOptions = searched.filter((o) => !recentIds.has(o.value));
  const filtered = [...recentOptions, ...otherOptions]; // one ordered list, drives keyboard highlight index

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function openDropdown() {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setHighlighted(0);
  }

  function choose(v: number | '') {
    onChange(v);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlighted];
      if (opt) choose(opt.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="searchable-select" style={style}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        value={open ? query : selected?.label ?? ''}
        placeholder={placeholder}
        onFocus={openDropdown}
        onClick={openDropdown}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlighted(0);
          if (!open) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="searchable-select-menu" role="listbox">
          <div
            className={`searchable-select-option muted ${highlighted === -1 ? 'highlighted' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              choose('');
            }}
          >
            {placeholder}
          </div>
          {filtered.length === 0 && <div className="searchable-select-option muted">No matches</div>}
          {recentOptions.length > 0 && <div className="searchable-select-group-label">Recent</div>}
          {recentOptions.map((o, i) => (
            <div
              key={`recent-${o.value}`}
              role="option"
              aria-selected={o.value === value}
              className={`searchable-select-option ${i === highlighted ? 'highlighted' : ''} ${o.value === value ? 'selected' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o.value);
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              {o.label}
              {o.sublabel && <span className="muted"> - {o.sublabel}</span>}
            </div>
          ))}
          {recentOptions.length > 0 && otherOptions.length > 0 && <div className="searchable-select-group-label">All</div>}
          {otherOptions.map((o, i) => {
            const idx = recentOptions.length + i;
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`searchable-select-option ${idx === highlighted ? 'highlighted' : ''} ${o.value === value ? 'selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o.value);
                }}
                onMouseEnter={() => setHighlighted(idx)}
              >
                {o.label}
                {o.sublabel && <span className="muted"> - {o.sublabel}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
