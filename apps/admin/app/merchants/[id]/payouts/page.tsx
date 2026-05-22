import Link from 'next/link';
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
  const successItems = result.items.filter((p) => p.status === 'succeeded');
  const successCount = successItems.length;
  const successRate = result.items.length ? successCount / result.items.length : 0;
  const stuckCount = result.items.filter(
    (p) => ['queued', 'processing', 'pending_approval', 'pending_confirmation'].includes(p.status)
      && new Date(p.created_at).getTime() < Date.now() - 3600_000,
  ).length;
  const reversalCount = result.items.filter((p) => p.reversal_indicator).length;

  const terminalItems = result.items.filter((p) => p.final_resolved_at && p.created_at);
  const medianLatencyMs = terminalItems.length > 0
    ? terminalItems
        .map((p) => new Date(p.final_resolved_at!).getTime() - new Date(p.created_at).getTime())
        .sort((a, b) => a - b)[Math.floor(terminalItems.length / 2)]
    : null;

  return (
    <PanelChrome
      merchant={detail.merchant}
      merchantId={id}
      currentTab="payouts"
    >
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <Kpi
          label="Volume"
          value={`KES ${(volumeCents / 100).toLocaleString()}`}
          sub={`${result.total} payout${result.total === 1 ? '' : 's'}`}
        />
        <Kpi label="Success rate" value={`${Math.round(successRate * 100)}%`} sub={`${successCount} succeeded`} />
        <Kpi
          label="Median latency"
          value={medianLatencyMs != null ? `${(medianLatencyMs / 1000).toFixed(0)}s` : '—'}
          sub="dispatch → terminal"
        />
        <Kpi label="Stuck" value={String(stuckCount)} sub={stuckCount > 0 ? '> 1h old' : 'none'} warn={stuckCount > 0} />
        <Kpi label="Reversals" value={String(reversalCount)} />
        <Kpi label="Total" value={String(result.total)} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Payout ID</th>
              <th className="text-left">Method</th>
              <th className="text-right">Recipient</th>
              <th className="text-right">Fee</th>
              <th className="text-right">Total debit</th>
              <th className="text-left">Status</th>
              <th className="text-left">Provider</th>
              <th className="text-left">TRF code</th>
              <th className="text-left">Created</th>
              <th className="text-left">Resolved</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-ogun-muted py-8">
                  No payouts yet — payouts appear here once the merchant
                  initiates a disbursement or a settlement triggers one.
                </td>
              </tr>
            )}
            {result.items.map((p) => (
              <tr key={p.id} className="border-t border-ogun-border hover:bg-ogun-bg/50">
                <td>
                  <Link
                    href={`/merchants/${id}/payouts/${p.id}`}
                    className="mono text-xs no-underline text-ogun-accent-on-dark"
                  >
                    {p.id}
                  </Link>
                </td>
                <td>{p.method}</td>
                <td className="text-right">KES {(Number(p.recipient_amount) / 100).toLocaleString()}</td>
                <td className="text-right text-ogun-muted">KES {(Number(p.fee_amount) / 100).toLocaleString()}</td>
                <td className="text-right">KES {(Number(p.total_debit) / 100).toLocaleString()}</td>
                <td><Badge status={p.status} /></td>
                <td className="text-xs text-ogun-muted">{p.provider_status ?? '—'}</td>
                <td className="mono text-xs text-ogun-muted max-w-[120px] truncate">
                  {p.provider_transfer_code ?? '—'}
                </td>
                <td className="text-xs text-ogun-muted">{formatIsoDate(p.created_at)}</td>
                <td className="text-xs text-ogun-muted">{p.final_resolved_at ? formatIsoDate(p.final_resolved_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelChrome>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }): React.ReactElement {
  return (
    <div className="panel-padded">
      <div className="text-xs text-ogun-muted">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${warn ? 'text-ogun-danger' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-ogun-muted mt-0.5">{sub}</div>}
    </div>
  );
}
