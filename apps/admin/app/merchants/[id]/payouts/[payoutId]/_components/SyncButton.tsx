'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { syncPayoutAction } from './syncAction';

export function SyncButton({
  payoutId,
  disabled,
}: {
  payoutId: string;
  disabled: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function handleSync() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const result = await syncPayoutAction(payoutId);
      if (result.error) {
        setIsError(true);
        setMessage(result.message);
      } else {
        setMessage(result.message);
        router.refresh();
      }
    });
  }

  return (
    <div>
      <button
        onClick={handleSync}
        disabled={disabled || isPending}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          disabled || isPending
            ? 'bg-ogun-border text-ogun-muted cursor-not-allowed'
            : 'bg-ogun-accent text-white hover:bg-ogun-accent/80 cursor-pointer'
        }`}
      >
        {isPending ? 'Syncing…' : 'Sync with provider'}
      </button>
      {message && (
        <p className={`text-xs mt-2 ${isError ? 'text-ogun-danger' : 'text-ogun-success'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
