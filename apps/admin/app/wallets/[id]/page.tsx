import Link from 'next/link';
import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { formatCents, formatIsoDate } from '@/components/Badge';
import { getWalletLedger } from '@/lib/api';

export default async function WalletDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;

  // We don't have a GET /admin/wallets/:id — look up via list + filter.
  // Fetch ledger entries directly; it succeeds even if we can't resolve
  // the parent row.
  const ledger = await getWalletLedger(id, { limit: 100 });

  return (
    <Page title="Wallet" subtitle={id}>
      <div className="panel overflow-x-auto">
        <table className="table-default">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Type</th>
              <th>Ref</th>
              <th>Direction</th>
              <th className="text-right">Amount</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {ledger.items.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-ogun-muted py-8">
                  No ledger entries.
                </td>
              </tr>
            )}
            {ledger.items.map((e) => (
              <tr key={e.id}>
                <td className="text-ogun-muted">{formatIsoDate(e.created_at)}</td>
                <td className="mono text-xs">{e.transaction_type}</td>
                <td className="mono text-xs">
                  {e.reference_type}/{e.reference_id}
                </td>
                <td>
                  <span
                    className={
                      e.direction === 'credit' ? 'text-ogun-success' : 'text-ogun-danger'
                    }
                  >
                    {e.direction}
                  </span>
                </td>
                <td className="text-right mono">{formatCents(e.amount, e.currency)}</td>
                <td className="text-ogun-muted text-xs">{e.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-8">
        <Link href="/wallets" className="text-sm">
          ← Back to wallets
        </Link>
      </div>
    </Page>
  );
}
