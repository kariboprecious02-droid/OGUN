'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

export type ToggleCol = { key: string; label: string };

export function CollectionColumnToggle({
  columns,
  enabledCols,
}: {
  columns: ToggleCol[];
  enabledCols: string[];
}): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const enabled = new Set(enabledCols);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggle(key: string) {
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const value = [...next].join(',');
    document.cookie = `ogun_admin_collections_toggle_cols=${value};path=/;max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-ogun-muted hover:text-ogun-text cursor-pointer flex items-center gap-1"
        title="Toggle optional columns"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-10 bg-ogun-surface border border-ogun-border rounded-md shadow-lg p-3 min-w-[180px]">
          <div className="text-[10px] text-ogun-muted uppercase mb-2">Optional columns</div>
          {columns.map((col) => (
            <label key={col.key} className="flex items-center gap-2 text-xs py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled.has(col.key)}
                onChange={() => toggle(col.key)}
                className="accent-ogun-accent"
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
