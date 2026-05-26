'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FundingModal } from '../../_components/FundingModal';
import { freezeWalletAction, unfreezeWalletAction } from '../../_actions';
import type { WalletSummary } from '@/lib/api';

export function WalletDetailControls({
  walletId,
  isFrozen,
  merchantId,
  showFreezeControls,
  walletSummary,
}: {
  walletId: string;
  isFrozen: boolean;
  merchantId: string;
  showFreezeControls?: boolean;
  walletSummary: WalletSummary;
}): React.ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showFunding, setShowFunding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function handleFreeze() {
    const reason = prompt('Freeze reason:');
    if (!reason) return;
    startTransition(async () => {
      const result = await freezeWalletAction(walletId, reason);
      setMsg(result.message);
      router.refresh();
    });
  }

  function handleUnfreeze() {
    startTransition(async () => {
      const result = await unfreezeWalletAction(walletId);
      setMsg(result.message);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {!showFreezeControls && (
          <button
            onClick={() => setShowFunding(true)}
            disabled={isFrozen}
            title={isFrozen ? 'Unfreeze the wallet first' : undefined}
            className={`px-3 py-1.5 text-sm rounded-md font-medium ${
              isFrozen
                ? 'bg-ogun-border text-ogun-muted cursor-not-allowed'
                : 'bg-ogun-accent text-white hover:bg-ogun-accent/80 cursor-pointer'
            }`}
          >
            + Fund wallet
          </button>
        )}
        {showFreezeControls && (
          <>
            {isFrozen ? (
              <button
                onClick={handleUnfreeze}
                disabled={isPending}
                className="px-3 py-1.5 text-sm rounded-md font-medium bg-ogun-success/20 text-ogun-success border border-ogun-success/30 hover:bg-ogun-success/30 cursor-pointer"
              >
                {isPending ? 'Unfreezing…' : '↻ Unfreeze wallet'}
              </button>
            ) : (
              <button
                onClick={handleFreeze}
                disabled={isPending}
                className="px-3 py-1.5 text-sm rounded-md font-medium bg-ogun-danger/20 text-ogun-danger border border-ogun-danger/30 hover:bg-ogun-danger/30 cursor-pointer"
              >
                {isPending ? 'Freezing…' : '⏸ Freeze wallet'}
              </button>
            )}
            <button disabled className="px-3 py-1.5 text-sm rounded-md border border-ogun-border text-ogun-muted cursor-not-allowed">
              Edit low-balance threshold
            </button>
            <button disabled className="px-3 py-1.5 text-sm rounded-md border border-ogun-border text-ogun-muted cursor-not-allowed">
              Configure alerts
            </button>
            <button disabled className="px-3 py-1.5 text-sm rounded-md border border-ogun-border text-ogun-muted cursor-not-allowed">
              Export statement
            </button>
          </>
        )}
        {msg && <span className="text-xs text-ogun-success ml-2">{msg}</span>}
      </div>
      {showFunding && (
        <FundingModal
          wallets={[walletSummary]}
          preselectedWalletId={walletId}
          onClose={() => setShowFunding(false)}
        />
      )}
    </>
  );
}
