'use client';

import { useState } from 'react';
import { FundingModal } from '@/app/wallets/_components/FundingModal';
import type { WalletSummary } from '@/lib/api';

export function FundWalletButton({ wallet }: { wallet: WalletSummary }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-sm rounded-md font-medium bg-ogun-accent text-white hover:bg-ogun-accent/80 cursor-pointer"
      >
        + Fund wallet
      </button>
      {open && (
        <FundingModal
          wallets={[wallet]}
          preselectedWalletId={wallet.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
