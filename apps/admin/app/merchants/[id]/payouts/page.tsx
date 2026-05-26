import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, listPayouts, listWallets, OgunApiError } from '@/lib/api';
import { PanelChrome } from '../_components/PanelChrome';
import { Badge, formatIsoDate } from '@/components/Badge';
import { PayoutFilters } from './_components/PayoutFilters';
import { FundWalletButton } from './_components/FundWalletButton';
import { ColumnToggle, type ToggleCol } from './_components/ColumnToggle';

const TOGGLE_COLS: ToggleCol[] = [
  { key: 'provider_status', label: 'Provider status' },
  { key: 'trf_code', label: 'TRF code' },
  { key: 'reference', label: 'Reference' },
  { key: 'provider_reference', label: 'Provider ref' },
  { key: 'reversal_indicator', label: 'Reversal' },
  { key: 'reversal_reason', label: 'Reversal reason' },
  { key: 'failure_reason', label: 'Failure reason' },
  { key: 'wallet_reserved_amount', label: 'Wallet reserved' },
  { key: 'idempotency_key', label: 'Idempotency key' },
];

export default async function MerchantPayoutsTab({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  let detail;
  try {
    detail = await getMerchantDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  const filters: Record<string, string | undefined> = {
    status: typeof sp.status === 'string' ? sp.status : undefined,
    method: typeof sp.method === 'string' ? sp.method : undefined,
    from: typeof sp.from === 'string' ? sp.from : undefined,
    to: typeof sp.to === 'string' ? sp.to : undefined,
    beneficiary: typeof sp.beneficiary === 'string' ? sp.beneficiary : undefined,
  };

  const [result, walletsResult] = await Promise.all([
    listPayouts({
      merchant_id: id,
      limit: 50,
      status: filters.status || undefined,
      method: filters.method || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      beneficiary_query: filters.beneficiary || undefined,
    }),
    listWallets({ merchant_id: id, wallet_type: 'payout', limit: 10 }),
  ]);
  const payoutWallet = walletsResult.items[0] ?? null;

  // Read toggled columns from cookie
  const cookieStore = await cookies();
  const toggleCookie = cookieStore.get('ogun_admin_payouts_toggle_cols')?.value ?? '';
  const enabledToggleCols = new Set(toggleCookie.split(',').filter(Boolean));

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

      {payoutWallet && (
        <div className="flex justify-end mb-4">
          <FundWalletButton wallet={payoutWallet} />
        </div>
      )}

      {/* Filter bar */}
      <PayoutFilters
        merchantId={id}
        currentStatus={filters.status}
        currentMethod={filters.method}
        currentFrom={filters.from}
        currentTo={filters.to}
        currentBeneficiary={filters.beneficiary}
      />

      <div className="panel overflow-x-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-ogun-border">
          <span className="text-xs text-ogun-muted">
            {result.total} payout{result.total === 1 ? '' : 's'}
          </span>
          <ColumnToggle
            columns={TOGGLE_COLS}
            enabledCols={Array.from(enabledToggleCols)}
          />
        </div>
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Payout ID</th>
              <th className="text-left">Method</th>
              <th className="text-left">Beneficiary</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Fee</th>
              <th className="text-right">Total debit</th>
              <th className="text-left">Status</th>
              <th className="text-left">Created</th>
              <th className="text-left">Resolved</th>
              {enabledToggleCols.has('provider_status') && <th className="text-left">Provider status</th>}
              {enabledToggleCols.has('trf_code') && <th className="text-left">TRF code</th>}
              {enabledToggleCols.has('reference') && <th className="text-left">Reference</th>}
              {enabledToggleCols.has('provider_reference') && <th className="text-left">Provider ref</th>}
              {enabledToggleCols.has('reversal_indicator') && <th className="text-left">Reversal</th>}
              {enabledToggleCols.has('reversal_reason') && <th className="text-left">Reversal reason</th>}
              {enabledToggleCols.has('failure_reason') && <th className="text-left">Failure reason</th>}
              {enabledToggleCols.has('wallet_reserved_amount') && <th className="text-right">Wallet reserved</th>}
              {enabledToggleCols.has('idempotency_key') && <th className="text-left">Idempotency key</th>}
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={9 + enabledToggleCols.size} className="text-center text-ogun-muted py-8">
                  No payouts found.
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
                <td className="text-xs max-w-[140px] truncate">{p.beneficiary_name ?? '—'}</td>
                <td className="text-right">KES {(Number(p.recipient_amount) / 100).toLocaleString()}</td>
                <td className="text-right text-ogun-muted">
                  KES {(Number(p.fee_amount) / 100).toLocaleString()}
                  <span className="ml-1 text-[10px] text-ogun-muted">{p.fee_model === 'recipient_covers' ? 'RC' : 'MC'}</span>
                </td>
                <td className="text-right">KES {(Number(p.total_debit) / 100).toLocaleString()}</td>
                <td><Badge status={p.status} /></td>
                <td className="text-xs text-ogun-muted">{formatIsoDate(p.created_at)}</td>
                <td className="text-xs text-ogun-muted">{p.final_resolved_at ? formatIsoDate(p.final_resolved_at) : '—'}</td>
                {enabledToggleCols.has('provider_status') && (
                  <td className="text-xs text-ogun-muted">{p.provider_status ?? '—'}</td>
                )}
                {enabledToggleCols.has('trf_code') && (
                  <td className="mono text-xs text-ogun-muted max-w-[120px] truncate">{p.provider_transfer_code ?? '—'}</td>
                )}
                {enabledToggleCols.has('reference') && (
                  <td className="mono text-xs text-ogun-muted max-w-[180px] truncate">{p.reference ?? '—'}</td>
                )}
                {enabledToggleCols.has('provider_reference') && (
                  <td className="mono text-xs text-ogun-muted max-w-[120px] truncate">{p.provider_reference ?? '—'}</td>
                )}
                {enabledToggleCols.has('reversal_indicator') && (
                  <td className="text-xs">{p.reversal_indicator ? '⚠ yes' : '—'}</td>
                )}
                {enabledToggleCols.has('reversal_reason') && (
                  <td className="text-xs text-ogun-muted max-w-[120px] truncate">
                    {(p as Record<string, unknown>).reversal_reason as string ?? '—'}
                  </td>
                )}
                {enabledToggleCols.has('failure_reason') && (
                  <td className="text-xs text-ogun-muted max-w-[120px] truncate">{p.failure_reason ?? '—'}</td>
                )}
                {enabledToggleCols.has('wallet_reserved_amount') && (
                  <td className="text-right text-xs text-ogun-muted">
                    {(p as Record<string, unknown>).wallet_reserved_amount != null
                      ? `KES ${(Number((p as Record<string, unknown>).wallet_reserved_amount) / 100).toLocaleString()}`
                      : '—'}
                  </td>
                )}
                {enabledToggleCols.has('idempotency_key') && (
                  <td className="mono text-xs text-ogun-muted max-w-[120px] truncate">
                    {(p as Record<string, unknown>).idempotency_key as string ?? '—'}
                  </td>
                )}
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
