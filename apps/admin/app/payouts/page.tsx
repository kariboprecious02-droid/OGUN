import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { Badge, formatCents, formatIsoDate } from '@/components/Badge';
import { listPayouts } from '@/lib/api';

const STATUSES = [
  'created',
  'queued',
  'processing',
  'pending_approval',
  'pending_confirmation',
  'succeeded',
  'failed',
  'reversed',
  'cancelled',
];

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : undefined;
  const merchantId = typeof params.merchant_id === 'string' ? params.merchant_id : undefined;
  const page = typeof params.page === 'string' ? Number(params.page) : 1;
  const result = await listPayouts({
    page,
    limit: 100,
    merchant_id: merchantId,
    status,
  });

  return (
    <Page
      title="Payouts"
      subtitle={`${result.total} payout${result.total === 1 ? '' : 's'} in view · detail view: status + provider_status + all fee fields`}
    >
      <form method="get" className="flex items-center gap-3 mb-4">
        <select
          name="status"
          defaultValue={status ?? ''}
          className="bg-ogun-surface border border-ogun-border rounded-md px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
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
              <th>ID</th>
              <th>Method</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Total debit</th>
              <th className="text-right">Recipient</th>
              <th>Fee model</th>
              <th>status</th>
              <th>provider_status</th>
              <th>Rev.</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-ogun-muted py-8">
                  No payouts match this filter.
                </td>
              </tr>
            )}
            {result.items.map((p) => (
              <tr key={p.id} className="hover:bg-ogun-bg/50">
                <td className="mono text-xs">{p.id}</td>
                <td>
                  <div>{p.method}</div>
                  <div className="text-xs text-ogun-muted">{p.provider}</div>
                </td>
                <td className="text-right mono">{formatCents(p.amount, p.currency)}</td>
                <td className="text-right mono">{formatCents(p.total_debit, p.currency)}</td>
                <td className="text-right mono">{formatCents(p.recipient_amount, p.currency)}</td>
                <td className="text-xs">{p.fee_model}</td>
                <td>
                  <Badge status={p.status} />
                </td>
                <td className="text-xs text-ogun-muted mono">{p.provider_status ?? '—'}</td>
                <td className="text-xs text-center">
                  {p.reversal_indicator ? <span className="text-ogun-warn">↺</span> : '—'}
                </td>
                <td className="text-xs text-ogun-muted">{formatIsoDate(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
