import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, listPayouts, OgunApiError } from '@/lib/api';
import { PanelChrome } from '../_components/PanelChrome';
import { Badge, formatIsoDate } from '@/components/Badge';

export default async function MerchantPayoutsTab({
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
  const result = await listPayouts({ merchant_id: id, limit: 50 });

  const volumeCents = result.items.reduce(
    (acc, p) => acc + Number(p.total_debit ?? 0),
    0,
  );
  const successCount = result.items.filter((p) => p.status === 'succeeded').length;
  const successRate = result.items.length ? successCount / result.items.length : 0;

  return (
    <PanelChrome
      merchant={detail.merchant}
      merchantId={id}
      currentTab="payouts"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Kpi
          label="Volume (last page)"
          value={`KES ${(volumeCents / 100).toLocaleString()}`}
        />
        <Kpi label="Total payouts" value={String(result.total)} />
        <Kpi label="Success rate" value={`${Math.round(successRate * 100)}%`} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th>Payout ID</th>
              <th>Method</th>
              <th>Amount</th>
              <th>Total debit</th>
              <th>Fee model</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-ogun-muted py-8">
                  No payouts yet.
                </td>
              </tr>
            )}
            {result.items.map((p) => (
              <tr key={p.id} className="border-t border-ogun-border">
                <td className="mono text-xs">{p.id}</td>
                <td>{p.method}</td>
                <td>KES {(Number(p.amount) / 100).toLocaleString()}</td>
                <td>KES {(Number(p.total_debit) / 100).toLocaleString()}</td>
                <td className="text-ogun-muted">{p.fee_model}</td>
                <td>
                  <Badge status={p.status} />
                </td>
                <td className="text-xs text-ogun-muted">
                  {formatIsoDate(p.created_at)}
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
