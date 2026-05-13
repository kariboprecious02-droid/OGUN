import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, listCollections, OgunApiError } from '@/lib/api';
import { PanelChrome } from '../_components/PanelChrome';
import { Badge, formatIsoDate } from '@/components/Badge';

export default async function MerchantCollectionsTab({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;
  let detail;
  try {
    detail = await getMerchantDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }
  const result = await listCollections({ merchant_id: id, limit: 50 });

  const attemptVolumeCents = result.items.reduce(
    (acc, c) => acc + Number(c.amount ?? 0),
    0,
  );
  const successfulItems = result.items.filter(
    (c) => c.business_status === 'successful',
  );
  const successVolumeCents = successfulItems.reduce(
    (acc, c) => acc + (Number(c.amount) - Number(c.fee_amount)),
    0,
  );
  const successRate = result.items.length
    ? successfulItems.length / result.items.length
    : 0;

  return (
    <PanelChrome
      merchant={detail.merchant}
      merchantId={id}
      currentTab="collections"
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Kpi
          label="Attempt volume"
          value={`KES ${(attemptVolumeCents / 100).toLocaleString()}`}
          sub={`${result.total} transaction${result.total === 1 ? '' : 's'}`}
        />
        <Kpi
          label="Net successful volume"
          value={`KES ${(successVolumeCents / 100).toLocaleString()}`}
          sub={`${successfulItems.length} succeeded`}
        />
        <Kpi label="Success rate" value={`${Math.round(successRate * 100)}%`} />
        <Kpi label="Total transactions" value={String(result.total)} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Collection ID</th>
              <th className="text-left">Sub-merchant</th>
              <th className="text-left">Method</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Fee</th>
              <th className="text-left">Status</th>
              <th className="text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-ogun-muted py-8">
                  No collections yet — once the merchant starts processing,
                  transactions appear here within ~30 seconds.
                </td>
              </tr>
            )}
            {result.items.map((c) => (
              <tr key={c.id} className="border-t border-ogun-border hover:bg-ogun-bg/50">
                <td>
                  <Link href={`/merchants/${id}/collections/${c.id}`} className="mono text-xs no-underline text-ogun-accent-on-dark">
                    {c.id}
                  </Link>
                </td>
                <td className="text-xs">{(c as Record<string, unknown>).sub_merchant_name as string ?? c.sub_merchant_id}</td>
                <td>{c.method}</td>
                <td className="text-right">KES {(Number(c.amount) / 100).toLocaleString()}</td>
                <td className="text-right text-ogun-muted">KES {(Number(c.fee_amount) / 100).toLocaleString()}</td>
                <td>
                  {c.refund_status === 'partial_refund' ? (
                    <Badge status="partial_refund" />
                  ) : (
                    <Badge status={c.business_status} />
                  )}
                </td>
                <td className="text-xs text-ogun-muted">{formatIsoDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelChrome>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }): React.ReactElement {
  return (
    <div className="panel-padded">
      <div className="text-xs text-ogun-muted">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-ogun-muted mt-0.5">{sub}</div>}
    </div>
  );
}
