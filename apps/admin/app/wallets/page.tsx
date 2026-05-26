import Link from 'next/link';
import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { Badge, formatCents } from '@/components/Badge';
import { listWallets } from '@/lib/api';

function walletStatus(available: number, threshold: number, isFrozen: boolean): { label: string; status: string } {
  if (isFrozen) return { label: 'Frozen', status: 'frozen' };
  if (available <= 0) return { label: 'Depleted', status: 'failed' };
  if (available < threshold) return { label: 'Low', status: 'pending' };
  return { label: 'Healthy', status: 'succeeded' };
}

function utilizationColor(available: number, threshold: number): string {
  if (available >= threshold * 2) return 'bg-ogun-success';
  if (available >= threshold) return 'bg-ogun-warn';
  return 'bg-ogun-danger';
}

export default async function WalletsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const params = await searchParams;
  const walletType =
    typeof params.wallet_type === 'string' && (params.wallet_type === 'collection' || params.wallet_type === 'payout')
      ? params.wallet_type
      : 'payout';
  const page = typeof params.page === 'string' ? Number(params.page) : 1;
  const result = await listWallets({ page, limit: 50, wallet_type: walletType });

  const threshold = 5000;

  return (
    <Page
      title="Wallets"
      subtitle={`${result.total} ${walletType} wallet${result.total === 1 ? '' : 's'}`}
    >
      <form method="get" className="flex items-center gap-3 mb-4">
        <select
          name="wallet_type"
          defaultValue={walletType}
          className="bg-ogun-surface border border-ogun-border rounded-md px-3 py-2 text-sm"
        >
          <option value="payout">Payout</option>
          <option value="collection">Collection</option>
        </select>
        <button type="submit" className="btn">Filter</button>
      </form>

      <div className="panel overflow-x-auto">
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Merchant</th>
              <th className="text-left">Wallet ID</th>
              <th className="text-right">Balance</th>
              <th className="text-left">Utilization</th>
              <th className="text-left">Status</th>
              <th className="text-left">Last funded</th>
              <th className="text-left"></th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-ogun-muted py-8">
                  No wallets match this filter.
                </td>
              </tr>
            )}
            {result.items.map((w) => {
              const s = walletStatus(w.available_balance, threshold, w.status === 'frozen');
              const pct = threshold > 0 ? Math.min(100, Math.round((w.available_balance / (threshold * 3)) * 100)) : 0;
              const barColor = utilizationColor(w.available_balance, threshold);
              return (
                <tr key={w.id} className="border-t border-ogun-border hover:bg-ogun-bg/50">
                  <td>
                    <div className="font-medium">{w.merchant_legal_name}</div>
                    <div className="text-xs text-ogun-muted">{w.sub_merchant_name}</div>
                  </td>
                  <td className="mono text-xs text-ogun-muted">{w.id.slice(0, 18)}…</td>
                  <td className="text-right">
                    <div className="font-semibold">{formatCents(w.available_balance, w.currency)}</div>
                    {w.reserved_balance > 0 && (
                      <div className="text-[11px] text-ogun-muted">+ {formatCents(w.reserved_balance, w.currency)} reserved</div>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-2 bg-ogun-border rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-ogun-muted">{formatCents(threshold, w.currency)}</span>
                    </div>
                  </td>
                  <td><Badge status={s.status} label={s.label} /></td>
                  <td className="text-xs text-ogun-muted">Never</td>
                  <td>
                    <Link href={`/wallets/${w.id}`} className="text-sm text-ogun-accent-on-dark no-underline">
                      View &rarr;
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
