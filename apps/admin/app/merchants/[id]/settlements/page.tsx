import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, listSettlements, listCollections, OgunApiError } from '@/lib/api';
import { PanelChrome } from '../_components/PanelChrome';
import { Badge, formatIsoDate } from '@/components/Badge';

export default async function MerchantSettlementsTab({
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
  const [result, collections] = await Promise.all([
    listSettlements({ merchant_id: id, limit: 50 }),
    listCollections({ merchant_id: id, business_status: 'successful', limit: 200 }),
  ]);

  const grossCents = result.items.reduce(
    (acc, s) => acc + Number(s.gross_amount ?? 0),
    0,
  );
  const netCents = result.items.reduce(
    (acc, s) => acc + Number(s.net_amount ?? 0),
    0,
  );
  const settledCount = result.items.filter((s) => s.status === 'paid' || s.status === 'settled').length;

  const eligibleItems = collections.items.filter((c) => c.settlement_eligible);
  const pendingSettlementCents = eligibleItems
    .reduce((acc, c) => acc + (Number(c.amount) - Number(c.fee_amount)), 0);
  const pendingCount = eligibleItems.length;

  return (
    <PanelChrome
      merchant={detail.merchant}
      merchantId={id}
      currentTab="settlements"
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Kpi
          label="Pending settlement (net)"
          value={`KES ${(pendingSettlementCents / 100).toLocaleString()}`}
          sub={`${pendingCount} collection${pendingCount === 1 ? '' : 's'} eligible`}
        />
        <Kpi
          label="Gross settled"
          value={`KES ${(grossCents / 100).toLocaleString()}`}
        />
        <Kpi
          label="Net settled"
          value={`KES ${(netCents / 100).toLocaleString()}`}
        />
        <Kpi label="Settled / total" value={`${settledCount} / ${result.total}`} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th>Settlement ID</th>
              <th>Sub-merchant</th>
              <th>Period</th>
              <th>Gross</th>
              <th>Fees</th>
              <th>Net</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-ogun-muted py-8">
                  No settlements yet — settlements run on the merchant's
                  configured cadence (daily / weekly / monthly).
                </td>
              </tr>
            )}
            {result.items.map((s) => (
              <tr key={s.id} className="border-t border-ogun-border">
                <td className="mono text-xs">{s.id}</td>
                <td className="mono text-xs">{s.sub_merchant_id}</td>
                <td className="text-xs text-ogun-muted">
                  {formatIsoDate(s.period_start)} →{' '}
                  {formatIsoDate(s.period_end)}
                </td>
                <td>KES {(Number(s.gross_amount) / 100).toLocaleString()}</td>
                <td className="text-ogun-muted">
                  KES{' '}
                  {(
                    (Number(s.fee_amount) + Number(s.settlement_fee)) /
                    100
                  ).toLocaleString()}
                </td>
                <td>KES {(Number(s.net_amount) / 100).toLocaleString()}</td>
                <td>
                  <Badge status={s.status} />
                </td>
                <td className="text-xs text-ogun-muted">
                  {formatIsoDate(s.updated_at)}
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
