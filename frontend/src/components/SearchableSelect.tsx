import { useEffect, useRef, useState } from 'react';

export interface SearchableSelectOption<T extends string | number = number> {
  value: T;
  label: string;
  sublabel?: string;
}

// A type-to-filter dropdown, near-drop-in for a native <select value=... onChange=...>: pass
// `options` (value/label/sublabel), `value` (0 or '' means "nothing selected"), and `onChange`.
// Used for the master-data pickers that get long (Raw Material, Product, Customer, HSN Code) -
// plain <select>s stay in place everywhere else (short, fixed lists don't need this).
//
// Generic over T so it also works for free-text string fields (e.g. Color) via `allowFreeText`,
// not just numeric master-data ids - see that prop's doc below.
export function SearchableSelect<T extends string | number = number>({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled,
  style,
  recentValues,
  allowFreeText,
}: {
  value: T | '';
  onChange: (value: T | '') => void;
  options: SearchableSelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  // Most-recent-first ids (see useRecentItems) - pinned at the top, under a "Recent" label,
  // only while the query is empty (typing searches everything, recency stops mattering).
  recentValues?: T[];
  // When true, this isn't a strict "pick from the list" selector - closing the dropdown
  // (click-outside or blur) with unsaved typed text commits that raw text as the value
  // instead of discarding it (the default, correct behavior for id-pickers that must
  // resolve to a real master row). Escape still discards, even in this mode - that's the
  // one explicit "cancel" gesture. Only meaningful for string-valued T (e.g. Color).
  allowFreeText?: boolean;
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
    ? (recentValues.map((id) => options.find((o) => o.value === id)).filter(Boolean) as SearchableSelectOption<T>[])
    : [];
  const recentIds = new Set(recentOptions.map((o) => o.value));
  const otherOptions = searched.filter((o) => !recentIds.has(o.value));
  const filtered = [...recentOptions, ...otherOptions]; // one ordered list, drives keyboard highlight index

  function closeAndMaybeCommit() {
    if (allowFreeText && open && trimmedQuery) {
      onChange(trimmedQuery as T);
    }
    setOpen(false);
    setQuery('');
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeAndMaybeCommit();
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  });

  function openDropdown() {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setHighlighted(0);
  }

  function choose(v: T | '') {
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
      if (opt) {
        choose(opt.value);
      } else if (allowFreeText && trimmedQuery) {
        choose(trimmedQuery as T);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Escape is the one explicit "cancel" gesture - discards typed text even in
      // allowFreeText mode, unlike blur/click-outside which commit it.
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  }

  const displayValue = open ? query : selected?.label ?? (allowFreeText && value !== '' ? String(value) : '');

  return (
    <div ref={containerRef} className="searchable-select" style={style}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        value={displayValue}
        placeholder={placeholder}
        onFocus={openDropdown}
        onClick={openDropdown}
        onBlur={closeAndMaybeCommit}
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
          {filtered.length === 0 && <div className="searchable-select-option muted">{allowFreeText ? 'No matches - press Enter to use what you typed' : 'No matches'}</div>}
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
