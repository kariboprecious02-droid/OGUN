import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { Badge, formatCents, formatIsoDate } from '@/components/Badge';
import { listCollections } from '@/lib/api';

const BUSINESS_STATUSES = ['pending', 'successful', 'failed', 'refunded'];

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const params = await searchParams;
  const status =
    typeof params.business_status === 'string' ? params.business_status : undefined;
  const merchantId = typeof params.merchant_id === 'string' ? params.merchant_id : undefined;
  const page = typeof params.page === 'string' ? Number(params.page) : 1;
  const result = await listCollections({
    page,
    limit: 100,
    merchant_id: merchantId,
    business_status: status,
  });

  return (
    <Page
      title="Collections"
      subtitle={`${result.total} collection${result.total === 1 ? '' : 's'} in view · dual-state view: both business_status and internal_status shown`}
    >
      <form method="get" className="flex items-center gap-3 mb-4">
        <select
          name="business_status"
          defaultValue={status ?? ''}
          className="bg-ogun-surface border border-ogun-border rounded-md px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {BUSINESS_STATUSES.map((s) => (
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
              <th className="text-right">Fee</th>
              <th>business_status</th>
              <th>internal_status</th>
              <th>Settled?</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-ogun-muted py-8">
                  No collections match this filter.
                </td>
              </tr>
            )}
            {result.items.map((c) => (
              <tr key={c.id} className="hover:bg-ogun-bg/50">
                <td className="mono text-xs">{c.id}</td>
                <td>
                  <div>{c.method}</div>
                  <div className="text-xs text-ogun-muted">{c.provider}</div>
                </td>
                <td className="text-right mono">{formatCents(c.amount, c.currency)}</td>
                <td className="text-right mono text-ogun-muted">
                  {formatCents(c.fee_amount, c.currency)}
                </td>
                <td>
                  <Badge
                    status={
                      c.refund_status === 'partial_refund'
                        ? 'partial_refund'
                        : c.business_status
                    }
                  />
                </td>
                <td className="text-xs text-ogun-muted mono">{c.internal_status}</td>
                <td className="text-xs">
                  {c.settlement_eligible ? (
                    <span className="text-ogun-success">eligible</span>
                  ) : (
                    <span className="text-ogun-muted">no</span>
                  )}
                </td>
                <td className="text-xs text-ogun-muted">{formatIsoDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
