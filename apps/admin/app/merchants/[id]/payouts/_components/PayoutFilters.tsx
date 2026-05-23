'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';

const STATUSES = [
  'created', 'queued', 'processing', 'pending_approval',
  'pending_confirmation', 'succeeded', 'failed', 'reversed', 'cancelled',
] as const;

const METHODS = ['mobile_money', 'bank_transfer', 'demo'] as const;

export function PayoutFilters({
  merchantId,
  currentStatus,
  currentMethod,
  currentFrom,
  currentTo,
  currentBeneficiary,
}: {
  merchantId: string;
  currentStatus?: string;
  currentMethod?: string;
  currentFrom?: string;
  currentTo?: string;
  currentBeneficiary?: string;
}): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const selectedStatuses = new Set(currentStatus?.split(',').filter(Boolean) ?? []);

  const [beneficiary, setBeneficiary] = useState(currentBeneficiary ?? '');
  const [from, setFrom] = useState(currentFrom ?? '');
  const [to, setTo] = useState(currentTo ?? '');

  function applyFilters(overrides: Record<string, string | undefined> = {}) {
    const qs = new URLSearchParams();
    const vals: Record<string, string | undefined> = {
      status: currentStatus,
      method: currentMethod,
      from: from || undefined,
      to: to || undefined,
      beneficiary: beneficiary || undefined,
      ...overrides,
    };
    for (const [k, v] of Object.entries(vals)) {
      if (v) qs.set(k, v);
    }
    const q = qs.toString();
    router.push(`${pathname}${q ? `?${q}` : ''}`);
  }

  function toggleStatus(s: string) {
    const next = new Set(selectedStatuses);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    applyFilters({ status: [...next].join(',') || undefined });
  }

  function setMethod(m: string | undefined) {
    applyFilters({ method: m });
  }

  function clearAll() {
    setBeneficiary('');
    setFrom('');
    setTo('');
    router.push(pathname);
  }

  const hasFilters = currentStatus || currentMethod || currentFrom || currentTo || currentBeneficiary;

  return (
    <div className="panel-padded mb-4 space-y-3">
      {/* Status chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ogun-muted mr-1">Status:</span>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className={`px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
              selectedStatuses.has(s)
                ? 'bg-ogun-accent text-white'
                : 'bg-ogun-bg border border-ogun-border text-ogun-muted hover:bg-ogun-surface'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Method + date + beneficiary */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-ogun-muted block mb-1">Method</label>
          <select
            value={currentMethod ?? ''}
            onChange={(e) => setMethod(e.target.value || undefined)}
            className="text-xs bg-ogun-bg border border-ogun-border rounded px-2 py-1 text-ogun-text"
          >
            <option value="">All</option>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-ogun-muted block mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onBlur={() => applyFilters()}
            className="text-xs bg-ogun-bg border border-ogun-border rounded px-2 py-1 text-ogun-text"
          />
        </div>

        <div>
          <label className="text-xs text-ogun-muted block mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={() => applyFilters()}
            className="text-xs bg-ogun-bg border border-ogun-border rounded px-2 py-1 text-ogun-text"
          />
        </div>

        <div>
          <label className="text-xs text-ogun-muted block mb-1">Beneficiary</label>
          <input
            type="text"
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            onBlur={() => applyFilters()}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
            placeholder="Name search…"
            className="text-xs bg-ogun-bg border border-ogun-border rounded px-2 py-1 text-ogun-text w-[140px]"
          />
        </div>

        {hasFilters && (
          <button
            onClick={clearAll}
            className="text-xs text-ogun-accent-on-dark underline cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
