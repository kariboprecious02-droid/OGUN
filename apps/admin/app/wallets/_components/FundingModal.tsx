'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fundWalletAction } from '../_actions';
import type { WalletSummary } from '@/lib/api';

const SOURCES = [
  {
    value: 'bank_transfer' as const,
    label: 'Bank transfer',
    helper: 'Funds wired from merchant\'s bank account to EBANX collection account, then credited to payout wallet',
  },
  {
    value: 'paybill_transfer' as const,
    label: 'Paybill transfer',
    helper: 'Treasury sends via M-Pesa Paybill; matches by reference + amount',
  },
];

export function FundingModal({
  wallets,
  preselectedWalletId,
  onClose,
}: {
  wallets: WalletSummary[];
  preselectedWalletId?: string;
  onClose: () => void;
}): React.ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [walletId, setWalletId] = useState(preselectedWalletId ?? '');
  const [amountStr, setAmountStr] = useState('');
  const [source, setSource] = useState<'bank_transfer' | 'paybill_transfer'>('bank_transfer');
  const [sourceRef, setSourceRef] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedWallet = wallets.find((w) => w.id === walletId);
  const amountKes = parseFloat(amountStr.replace(/,/g, '')) || 0;
  const amountCents = Math.round(amountKes * 100);
  const canSubmit = walletId && amountCents > 0 && reason.trim().length >= 3;
  const sourceInfo = SOURCES.find((s) => s.value === source);
  const cameFromMerchant = !!preselectedWalletId;

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await fundWalletAction({
        wallet_id: walletId,
        amount: amountCents,
        currency: 'KES',
        source,
        source_reference: sourceRef.trim() || null,
        reason: reason.trim(),
      });
      if (result.error) {
        setError(result.message);
      } else {
        setSuccessMsg(result.message);
        router.refresh();
        setTimeout(() => onClose(), 1500);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-ogun-surface border border-ogun-border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-5">Fund wallet</h2>

        {/* 1. Current balance panel */}
        {selectedWallet && (
          <div className="p-4 rounded bg-ogun-bg border border-ogun-accent-on-dark/30 mb-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ogun-muted">Current balance</span>
              <span className="text-2xl font-semibold text-ogun-text">
                KES {(selectedWallet.available_balance / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="text-[11px] text-ogun-muted mt-1">
              Low-balance threshold KES 50.00
            </div>
            {selectedWallet.status === 'frozen' && (
              <div className="text-ogun-warn mt-2 text-xs">
                ⚠ Wallet is frozen. Funding will queue and not credit until unfrozen.
              </div>
            )}
          </div>
        )}

        {/* 2. Funded by */}
        <div className="mb-4">
          <label className="text-xs font-medium text-ogun-text block mb-1">
            Funded by *
            <span className="text-ogun-accent-on-dark normal-case ml-2 font-normal">— pre-selected from your session</span>
          </label>
          <select disabled className="w-full bg-ogun-bg border border-ogun-border rounded px-3 py-2 text-sm text-ogun-muted cursor-not-allowed">
            <option>admin@ogun-pay.io</option>
          </select>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="w-5 h-5 rounded-full bg-ogun-accent text-white text-[10px] flex items-center justify-center font-semibold">A</div>
            <span className="text-[11px] text-ogun-muted">Funding will be attributed to Admin (Platform Admin)</span>
          </div>
        </div>

        {/* 3. Wallet select */}
        <div className="mb-4">
          <label className="text-xs font-medium text-ogun-text block mb-1">
            Wallet
            {cameFromMerchant && (
              <span className="text-ogun-accent-on-dark normal-case ml-1 font-normal">— pre-selected from merchant payouts page</span>
            )}
          </label>
          <select
            value={walletId}
            onChange={(e) => setWalletId(e.target.value)}
            disabled={cameFromMerchant}
            className={`w-full bg-ogun-bg border border-ogun-border rounded px-3 py-2 text-sm ${cameFromMerchant ? 'text-ogun-muted cursor-not-allowed' : 'text-ogun-text'}`}
          >
            <option value="">Select a wallet…</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.merchant_legal_name} — {w.sub_merchant_name} (KES {(w.available_balance / 100).toLocaleString()})
              </option>
            ))}
          </select>
        </div>

        {/* 4. Amount */}
        <div className="mb-4">
          <label className="text-xs font-medium text-ogun-text block mb-1">Amount (KES)</label>
          <input
            type="text"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="e.g. 250,000"
            className="w-full bg-ogun-bg border border-ogun-border rounded px-3 py-2 text-sm text-ogun-text"
          />
          {amountCents > 0 && (
            <div className="text-[11px] text-ogun-muted mt-1">= {amountCents.toLocaleString()} cents</div>
          )}
        </div>

        {/* 5. Funding source */}
        <div className="mb-4">
          <label className="text-xs font-medium text-ogun-text block mb-1">Funding source</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as 'bank_transfer' | 'paybill_transfer')}
            className="w-full bg-ogun-bg border border-ogun-border rounded px-3 py-2 text-sm text-ogun-text"
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {sourceInfo && (
            <div className="text-[11px] text-ogun-muted mt-1.5">{sourceInfo.helper}</div>
          )}
        </div>

        {/* 6. External reference */}
        <div className="mb-4">
          <label className="text-xs font-medium text-ogun-text block mb-1">External reference (optional)</label>
          <input
            type="text"
            value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)}
            placeholder="e.g. EFT-2026-05-22-001 — leave blank to auto-generate"
            className="w-full bg-ogun-bg border border-ogun-border rounded px-3 py-2 text-sm text-ogun-text"
          />
        </div>

        {/* 7. Reason */}
        <div className="mb-5">
          <label className="text-xs font-medium text-ogun-text block mb-1">Reason / business context</label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this top-up? (audit trail)"
            className="w-full bg-ogun-bg border border-ogun-border rounded px-3 py-2 text-sm text-ogun-text resize-none"
          />
        </div>

        {/* Error / Success */}
        {error && <div className="p-3 mb-4 rounded bg-ogun-danger/10 border border-ogun-danger text-sm text-ogun-danger">{error}</div>}
        {successMsg && <div className="p-3 mb-4 rounded bg-ogun-success/10 border border-ogun-success text-sm text-ogun-success">✓ {successMsg}</div>}

        {/* Footer */}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-ogun-border text-ogun-muted hover:bg-ogun-bg cursor-pointer">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isPending}
            className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
              canSubmit && !isPending
                ? 'bg-ogun-accent text-white hover:bg-ogun-accent/80 cursor-pointer'
                : 'bg-ogun-border text-ogun-muted cursor-not-allowed'
            }`}
          >
            {isPending ? 'Funding…' : 'Fund wallet'}
          </button>
        </div>
      </div>
    </div>
  );
}
