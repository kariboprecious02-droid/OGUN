import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getWalletDetail, listWalletTopups, listPayouts, getWalletLedger, OgunApiError } from '@/lib/api';
import { Nav } from '@/components/Nav';
import { Badge, formatCents, formatIsoDate } from '@/components/Badge';
import { WalletDetailControls } from './_components/WalletDetailControls';

// Always render fresh so router.refresh() after a funding event re-fetches
// the balance, KPIs, funding history, AND transactions list together.
export const dynamic = 'force-dynamic';

export default async function WalletDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;

  let w;
  try {
    w = await getWalletDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  const [topups, payoutsResult, ledger] = await Promise.all([
    listWalletTopups(id, { limit: 20 }).catch(() => ({ items: [], page: 1, limit: 20, total: 0 })),
    w.wallet_type === 'payout'
      ? listPayouts({ merchant_id: w.merchant_id, limit: 5 }).catch(() => ({ items: [], page: 1, limit: 5, total: 0 }))
      : Promise.resolve({ items: [], page: 1, limit: 5, total: 0 }),
    getWalletLedger(id, { limit: 50 }).catch(() => ({ items: [], page: 1, limit: 50, total: 0 })),
  ]);

  const utilizationPct = w.lifetime_funded > 0
    ? Math.round((w.lifetime_disbursed / w.lifetime_funded) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-ogun-bg text-ogun-text">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-4">
          <Link href="/wallets" className="text-sm text-ogun-accent-on-dark no-underline">
            &larr; Back to wallets
          </Link>
        </div>

        {/* Header */}
        <section className="panel-padded mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold">{w.merchant_legal_name}</h1>
              <div className="text-sm text-ogun-muted mt-1">{w.sub_merchant_name} &middot; {w.currency}</div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-ogun-bg border border-ogun-border">
                  <span className="text-ogun-muted">wallet</span> <span className="mono">{w.id.slice(0, 18)}…</span>
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-ogun-bg border border-ogun-border">
                  <span className="text-ogun-muted">sub_merchant</span> <span className="mono">{w.sub_merchant_id.slice(0, 18)}…</span>
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-ogun-bg border border-ogun-border">
                  <span className="text-ogun-muted">type</span> <span>{w.wallet_type}</span>
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-semibold">{formatCents(w.available_balance, w.currency)}</div>
              {w.reserved_balance > 0 && (
                <div className="text-sm text-ogun-muted mt-1">+ {formatCents(w.reserved_balance, w.currency)} reserved</div>
              )}
              <div className="mt-2">
                <Badge status={w.is_frozen ? 'frozen' : w.available_balance < w.low_balance_threshold ? 'low' : 'healthy'} label={w.is_frozen ? 'Frozen' : w.available_balance < w.low_balance_threshold ? 'Low' : 'Healthy'} />
              </div>
            </div>
          </div>
          {w.is_frozen && (
            <div className="mt-4 p-3 rounded bg-ogun-danger/10 border border-ogun-danger">
              <div className="text-sm font-medium text-ogun-danger">Wallet frozen</div>
              {w.freeze_reason && <div className="text-xs text-ogun-muted mt-1">{w.freeze_reason}</div>}
              {w.frozen_by && <div className="text-xs text-ogun-muted mt-0.5">By {w.frozen_by} &middot; {w.frozen_at ? formatIsoDate(w.frozen_at) : ''}</div>}
            </div>
          )}
        </section>

        {/* KPI row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="panel-padded">
            <div className="text-xs text-ogun-muted">Total funded (lifetime)</div>
            <div className="text-xl font-semibold mt-1">{formatCents(w.lifetime_funded, w.currency)}</div>
          </div>
          <div className="panel-padded">
            <div className="text-xs text-ogun-muted">Total disbursed (lifetime)</div>
            <div className="text-xl font-semibold mt-1">{formatCents(w.lifetime_disbursed, w.currency)}</div>
            <div className="text-xs text-ogun-muted mt-0.5">{utilizationPct}% utilization</div>
          </div>
          <div className="panel-padded">
            <div className="text-xs text-ogun-muted">Median disbursement</div>
            <div className="text-xl font-semibold mt-1">
              {w.median_disbursement != null ? formatCents(w.median_disbursement, w.currency) : '—'}
            </div>
          </div>
        </div>

        {/* Transactions */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Transactions ({ledger.total})
          </h2>
          <div className="overflow-x-auto">
            <table className="table-default w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Date</th>
                  <th className="text-left">Type</th>
                  <th className="text-left">Reference</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left">Description</th>
                </tr>
              </thead>
              <tbody>
                {ledger.items.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-ogun-muted py-6">No transactions yet.</td></tr>
                )}
                {ledger.items.map((e) => {
                  const isCredit = e.direction === 'credit';
                  return (
                    <tr key={e.id} className="border-t border-ogun-border">
                      <td className="text-xs text-ogun-muted">{formatIsoDate(e.created_at)}</td>
                      <td className="mono text-xs">{e.transaction_type.replace(/_/g, ' ')}</td>
                      <td className="mono text-xs text-ogun-muted">{e.reference_type}/{e.reference_id.slice(0, 16)}…</td>
                      <td className={`text-right font-semibold ${isCredit ? 'text-ogun-success' : 'text-ogun-danger'}`}>
                        {isCredit ? '+' : '−'} {formatCents(e.amount, e.currency)}
                      </td>
                      <td className="text-xs text-ogun-muted">{e.description ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Payouts section */}
        {w.wallet_type === 'payout' && (
          <section className="panel-padded mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted">Payouts</h2>
                <p className="text-[11px] text-ogun-muted mt-0.5">
                  Outbound disbursements from this wallet &middot; Fund the payout wallet here to enable new payouts
                </p>
              </div>
              <WalletDetailControls
                walletId={w.id}
                isFrozen={w.is_frozen}
                merchantId={w.merchant_id}
                walletSummary={{ id: w.id, merchant_legal_name: w.merchant_legal_name, sub_merchant_name: w.sub_merchant_name, available_balance: w.available_balance, status: w.status, merchant_id: w.merchant_id, sub_merchant_id: w.sub_merchant_id, wallet_type: w.wallet_type, currency: w.currency, reserved_balance: w.reserved_balance }}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="table-default w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Payout ID</th>
                    <th className="text-left">Date</th>
                    <th className="text-left">Beneficiary</th>
                    <th className="text-right">Amount</th>
                    <th className="text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutsResult.items.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-ogun-muted py-6">No payouts yet.</td></tr>
                  )}
                  {payoutsResult.items.map((p) => (
                    <tr key={p.id} className="border-t border-ogun-border hover:bg-ogun-bg/50">
                      <td>
                        <Link href={`/merchants/${w.merchant_id}/payouts/${p.id}`} className="mono text-xs no-underline text-ogun-accent-on-dark">
                          {p.id}
                        </Link>
                      </td>
                      <td className="text-xs text-ogun-muted">{formatIsoDate(p.created_at)}</td>
                      <td className="text-xs">{p.beneficiary_name ?? '—'}</td>
                      <td className="text-right">{formatCents(p.recipient_amount, p.currency)}</td>
                      <td><Badge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Funding history */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">Funding history</h2>
          <div className="overflow-x-auto">
            <table className="table-default w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Funding ID</th>
                  <th className="text-left">Date</th>
                  <th className="text-left">Source</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left">Funded by</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {topups.items.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-ogun-muted py-6">No funding history yet — this wallet has not been funded.</td></tr>
                )}
                {topups.items.map((t) => (
                  <tr key={t.id} className="border-t border-ogun-border">
                    <td className="mono text-xs text-ogun-muted">{t.id}</td>
                    <td className="text-xs text-ogun-muted">{formatIsoDate(t.created_at)}</td>
                    <td className="text-xs">{t.source === 'bank_transfer' ? 'Bank transfer' : 'Paybill transfer'}</td>
                    <td className="text-right font-semibold">{formatCents(t.amount, t.currency)}</td>
                    <td className="text-xs text-ogun-muted">{t.initiated_by}</td>
                    <td><Badge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Wallet controls */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">Wallet controls</h2>
          <WalletDetailControls
            walletId={w.id}
            isFrozen={w.is_frozen}
            merchantId={w.merchant_id}
            showFreezeControls
            walletSummary={{ id: w.id, merchant_legal_name: w.merchant_legal_name, sub_merchant_name: w.sub_merchant_name, available_balance: w.available_balance, status: w.status, merchant_id: w.merchant_id, sub_merchant_id: w.sub_merchant_id, wallet_type: w.wallet_type, currency: w.currency, reserved_balance: w.reserved_balance }}
          />
        </section>
      </main>
    </div>
  );
}
