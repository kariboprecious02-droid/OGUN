'use client';

import { useRef, useEffect, useCallback } from 'react';

/**
 * Wraps a form region and prevents accidental navigation when the form
 * has unsaved changes. Catches both browser-level navigation (tab close,
 * URL bar) via `beforeunload` and App Router `<Link>` clicks by
 * intercepting anchor click events with `confirm()`.
 */
export function DirtyFormGuard({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const dirtyRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const markClean = useCallback(() => {
    dirtyRef.current = false;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleInput = () => {
      dirtyRef.current = true;
    };

    const handleSubmit = () => {
      dirtyRef.current = false;
    };

    container.addEventListener('input', handleInput);
    container.addEventListener('change', handleInput);
    container.addEventListener('submit', handleSubmit, true);

    return () => {
      container.removeEventListener('input', handleInput);
      container.removeEventListener('change', handleInput);
      container.removeEventListener('submit', handleSubmit, true);
    };
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      const anchor = (e.target as HTMLElement).closest('a[href]');
      if (!anchor) return;
      if (anchor.closest('form')) return;
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#') || href.startsWith('javascript:')) return;

      const ok = window.confirm(
        'You have unsaved changes. Leave this page?',
      );
      if (!ok) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        dirtyRef.current = false;
      }
    };

    container.addEventListener('click', handleClick, true);
    return () => container.removeEventListener('click', handleClick, true);
  }, []);

  return (
    <div ref={containerRef} data-dirty-guard>
      <DirtyFormContext.Provider value={{ markDirty, markClean }}>
        {children}
      </DirtyFormContext.Provider>
    </div>
  );
}

import { createContext, useContext } from 'react';

const DirtyFormContext = createContext<{
  markDirty: () => void;
  markClean: () => void;
}>({ markDirty: () => {}, markClean: () => {} });

export function useDirtyForm() {
  return useContext(DirtyFormContext);
}
