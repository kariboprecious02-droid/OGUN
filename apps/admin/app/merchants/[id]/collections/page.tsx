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
              <th>Collection ID</th>
              <th>Method</th>
              <th>Amount</th>
              <th>Fee</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-ogun-muted py-8">
                  No collections yet — once the merchant starts processing,
                  transactions appear here within ~30 seconds.
                </td>
              </tr>
            )}
            {result.items.map((c) => (
              <tr
                key={c.id}
                className="border-t border-ogun-border hover:bg-ogun-bg/50 cursor-pointer"
                onClick={undefined}
              >
                <td colSpan={6} className="p-0">
                  <Link
                    href={`/merchants/${id}/collections/${c.id}`}
                    className="no-underline text-ogun-text flex"
                  >
                    <span className="mono text-xs px-3 py-2 flex-shrink-0 w-[280px]">{c.id}</span>
                    <span className="px-3 py-2 flex-shrink-0 w-[80px]">{c.method}</span>
                    <span className="px-3 py-2 flex-shrink-0 w-[100px]">KES {(Number(c.amount) / 100).toLocaleString()}</span>
                    <span className="px-3 py-2 flex-shrink-0 w-[100px] text-ogun-muted">KES {(Number(c.fee_amount) / 100).toLocaleString()}</span>
                    <span className="px-3 py-2 flex-shrink-0 w-[100px]"><Badge status={c.business_status} /></span>
                    <span className="px-3 py-2 flex-1 text-xs text-ogun-muted">{formatIsoDate(c.created_at)}</span>
                  </Link>
                </td>
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
