import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getSettlementDetail, getMerchantDetail, OgunApiError, centsToKes } from '@/lib/api';
import { Nav } from '@/components/Nav';
import { Badge, formatIsoDate } from '@/components/Badge';

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string; stlId: string }>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id, stlId } = await params;

  let detail;
  let s;
  try {
    const [d, stl] = await Promise.all([
      getMerchantDetail(id),
      getSettlementDetail(stlId),
    ]);
    detail = d;
    s = stl;
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  const gross = centsToKes(s.gross_amount);
  const fees = centsToKes(s.fee_amount);
  const settlementFee = centsToKes(s.settlement_fee);
  const refundAdj = centsToKes(s.refund_adjustment_amount);
  const net = centsToKes(s.net_amount);
  const rounding = centsToKes(s.settlement_rounding_subsidy ?? 0);

  return (
    <div className="min-h-screen bg-ogun-bg text-ogun-text">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-4">
          <Link
            href={`/merchants/${id}/settlements`}
            className="text-sm text-ogun-accent-on-dark no-underline"
          >
            &larr; Back to settlements
          </Link>
        </div>

        <section className="panel-padded mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-lg font-semibold mono">{s.id}</h1>
              <div className="text-sm text-ogun-muted mt-1">
                {s.sub_merchant_name ?? s.sub_merchant_id} &middot;
                Period: {formatIsoDate(s.period_start)} → {formatIsoDate(s.period_end)}
              </div>
              <div className="text-xs text-ogun-muted mt-1">
                Created {formatIsoDate(s.created_at)}
                {s.updated_at && <> &middot; Updated {formatIsoDate(s.updated_at)}</>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold">KES {net.toLocaleString()}</span>
              <Badge status={s.status} />
            </div>
          </div>
        </section>

        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Settlement breakdown
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-ogun-muted">Gross</div>
              <div className="font-semibold">KES {gross.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-ogun-muted">Collection fees</div>
              <div className="font-semibold">KES {fees.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-ogun-muted">Settlement fee</div>
              <div className="font-semibold">KES {settlementFee.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-ogun-muted">Refund adjustments</div>
              <div className="font-semibold">KES {refundAdj.toLocaleString()}</div>
            </div>
          </div>
          {rounding > 0 && (
            <div className="mt-3 text-xs text-ogun-muted">
              Rounding subsidy: KES {rounding.toLocaleString()} (rounded UP to whole KES for Paystack payout)
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-ogun-border">
            <div className="flex justify-between text-sm">
              <span className="text-ogun-muted">Net payable</span>
              <span className="font-semibold text-lg">KES {net.toLocaleString()}</span>
            </div>
          </div>
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm mt-4">
            <Kv k="Transaction count" v={s.transaction_count} />
            <Kv k="Payout ID" v={s.payout_id} mono />
            <Kv k="Report URL" v={s.report_url ? 'Available' : null} />
          </dl>
        </section>

        {s.status === 'failed' && (
          <section className="panel-padded mb-6 border border-rose-700/40">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-300 mb-2">
              Settlement failed
            </h2>
            <p className="text-sm text-ogun-muted">
              This settlement batch failed during execution. Common causes: insufficient
              collection wallet balance, payout dispatch failure, or provider rejection.
              Check the linked payout (if created) for provider-level detail.
            </p>
          </section>
        )}

        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Source collections ({s.line_items.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="table-default w-full text-sm">
              <thead>
                <tr>
                  <th>Collection ID</th>
                  <th>Type</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Direction</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {s.line_items.map((li) => (
                  <tr key={li.id} className="border-t border-ogun-border">
                    <td>
                      <Link
                        href={`/merchants/${id}/collections/${li.reference_id}`}
                        className="mono text-xs no-underline text-ogun-accent-on-dark"
                      >
                        {li.reference_id}
                      </Link>
                    </td>
                    <td className="text-xs">{li.reference_type}</td>
                    <td>{li.method ?? '—'}</td>
                    <td className="text-right">KES {centsToKes(li.amount).toLocaleString()}</td>
                    <td>{li.direction}</td>
                    <td>{li.business_status ? <Badge status={li.business_status} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function Kv({ k, v, mono }: { k: string; v: string | number | null | undefined; mono?: boolean }): React.ReactElement {
  return (
    <div>
      <dt className="text-xs text-ogun-muted">{k}</dt>
      <dd className={mono ? 'mono text-sm' : 'text-sm'}>
        {v == null || v === '' ? <span className="italic text-ogun-muted">null</span> : String(v)}
      </dd>
    </div>
  );
}
