import Link from 'next/link';
import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { Badge, formatCents } from '@/components/Badge';
import { listWallets } from '@/lib/api';

export default async function WalletsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const params = await searchParams;
  const merchantId = typeof params.merchant_id === 'string' ? params.merchant_id : undefined;
  const walletType =
    typeof params.wallet_type === 'string' && (params.wallet_type === 'collection' || params.wallet_type === 'payout')
      ? params.wallet_type
      : undefined;
  const page = typeof params.page === 'string' ? Number(params.page) : 1;
  const result = await listWallets({
    page,
    limit: 50,
    merchant_id: merchantId,
    wallet_type: walletType,
  });

  return (
    <Page
      title="Wallets"
      subtitle={`${result.total} wallet${result.total === 1 ? '' : 's'} in view`}
    >
      <form method="get" className="flex items-center gap-3 mb-4">
        <select
          name="wallet_type"
          defaultValue={walletType ?? ''}
          className="bg-ogun-surface border border-ogun-border rounded-md px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          <option value="collection">Collection</option>
          <option value="payout">Payout</option>
        </select>
        <input
          type="text"
          name="merchant_id"
          placeholder="Merchant ID (mrc_…)"
          defaultValue={merchantId ?? ''}
          className="bg-ogun-surface border border-ogun-border rounded-md px-3 py-2 text-sm font-mono flex-1 max-w-md"
        />
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      <div className="panel overflow-x-auto">
        <table className="table-default">
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Merchant</th>
              <th>Sub-merchant</th>
              <th>Type</th>
              <th className="text-right">Available</th>
              <th className="text-right">Reserved</th>
              <th>Status</th>
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
            {result.items.map((w) => (
              <tr key={w.id} className="hover:bg-ogun-bg/50">
                <td className="mono">
                  <Link href={`/wallets/${w.id}`} className="no-underline text-ogun-text hover:text-ogun-accent-on-dark">
                    {w.id}
                  </Link>
                </td>
                <td>
                  <div>{w.merchant_legal_name}</div>
                  <div className="mono text-xs text-ogun-muted">{w.merchant_id}</div>
                </td>
                <td>
                  <div>{w.sub_merchant_name}</div>
                  <div className="mono text-xs text-ogun-muted">{w.sub_merchant_id}</div>
                </td>
                <td>
                  <span className="badge badge-active">{w.wallet_type}</span>
                </td>
                <td className="text-right mono">{formatCents(w.available_balance, w.currency)}</td>
                <td className="text-right mono text-ogun-muted">
                  {formatCents(w.reserved_balance, w.currency)}
                </td>
                <td>
                  <Badge status={w.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
