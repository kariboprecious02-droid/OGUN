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

  // Aggregate KPIs from the visible page
  const tpvCents = result.items.reduce(
    (acc, c) => acc + Number(c.amount ?? 0),
    0,
  );
  const successCount = result.items.filter(
    (c) => c.business_status === 'successful',
  ).length;
  const successRate = result.items.length
    ? successCount / result.items.length
    : 0;

  return (
    <PanelChrome
      merchant={detail.merchant}
      merchantId={id}
      currentTab="collections"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Kpi label="TPV (last page)" value={`KES ${(tpvCents / 100).toLocaleString()}`} />
        <Kpi label="Total transactions" value={String(result.total)} />
        <Kpi label="Success rate" value={`${Math.round(successRate * 100)}%`} />
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
                  No collections yet.
                </td>
              </tr>
            )}
            {result.items.map((c) => (
              <tr key={c.id} className="border-t border-ogun-border">
                <td className="mono text-xs">{c.id}</td>
                <td>{c.method}</td>
                <td>KES {(Number(c.amount) / 100).toLocaleString()}</td>
                <td className="text-ogun-muted">
                  KES {(Number(c.fee_amount) / 100).toLocaleString()}
                </td>
                <td>
                  <Badge status={c.business_status} />
                </td>
                <td className="text-xs text-ogun-muted">
                  {formatIsoDate(c.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelChrome>
  );
}

function Kpi({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="panel-padded">
      <div className="text-xs text-ogun-muted">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}
