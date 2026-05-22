import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getPayoutDetail, getMerchantDetail, OgunApiError, centsToKes } from '@/lib/api';
import { Nav } from '@/components/Nav';
import { Badge, formatIsoDate } from '@/components/Badge';

const PAYOUT_STEPS = [
  { key: 'created', label: 'Created' },
  { key: 'queued', label: 'Queued' },
  { key: 'processing', label: 'Processing' },
  { key: 'succeeded', label: 'Succeeded' },
] as const;

type StepState = 'done' | 'active' | 'failed' | 'pending';

function deriveStepStates(p: Awaited<ReturnType<typeof getPayoutDetail>>): {
  states: StepState[];
  stopStep: number;
  stopReason: string;
} {
  const states: StepState[] = new Array(4).fill('pending');
  let stopStep = -1;
  let stopReason = '';

  // Step 0: Created — always done if the record exists
  if (p.created_at) states[0] = 'done';

  // Step 1: Queued
  if (p.status === 'queued' || p.status === 'processing' || p.status === 'succeeded' || p.status === 'failed' || p.status === 'reversed') {
    states[1] = 'done';
  }

  // Step 2: Processing
  if (p.status === 'processing' || p.status === 'succeeded' || p.status === 'failed' || p.status === 'reversed') {
    states[2] = 'done';
  } else if (states[1] === 'done' && p.status === 'queued') {
    states[2] = 'active';
    if (stopStep < 0) { stopStep = 2; stopReason = 'in progress'; }
  }

  // Step 3: Succeeded
  if (p.status === 'succeeded') {
    states[3] = 'done';
  } else if (p.status === 'failed') {
    states[3] = 'failed';
    if (stopStep < 0) { stopStep = 3; stopReason = p.failure_reason ?? 'failed'; }
  } else if (p.status === 'reversed') {
    states[3] = 'failed';
    if (stopStep < 0) { stopStep = 3; stopReason = p.reversal_reason ?? 'reversed'; }
  }

  // If no explicit stop, find the first pending step
  if (stopStep < 0) {
    for (let i = 0; i < 4; i++) {
      if (states[i] === 'pending') { stopStep = i; stopReason = 'in progress'; break; }
    }
  }

  return { states, stopStep, stopReason };
}

export default async function PayoutDetailPage({
  params,
}: {
  params: Promise<{ id: string; payoutId: string }>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id, payoutId } = await params;

  let detail;
  let p;
  try {
    const [d, payout] = await Promise.all([
      getMerchantDetail(id),
      getPayoutDetail(payoutId),
    ]);
    detail = d;
    p = payout;
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  const { states, stopStep, stopReason } = deriveStepStates(p);
  const recipientAmount = centsToKes(p.recipient_amount);
  const totalDebit = centsToKes(p.total_debit);
  const feeAmount = centsToKes(p.fee_amount);
  const walletReserved = p.wallet_reserved_amount != null ? centsToKes(p.wallet_reserved_amount) : null;

  const convergenceLatency =
    p.created_at && p.final_resolved_at
      ? `${((new Date(p.final_resolved_at).getTime() - new Date(p.created_at).getTime()) / 1000).toFixed(1)}s`
      : null;

  return (
    <div className="min-h-screen bg-ogun-bg text-ogun-text">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-4">
          <Link
            href={`/merchants/${id}/payouts`}
            className="text-sm text-ogun-accent-on-dark no-underline"
          >
            &larr; Back to payouts
          </Link>
        </div>

        {/* Header strip */}
        <section className="panel-padded mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-lg font-semibold mono">{p.id}</h1>
              <div className="text-sm text-ogun-muted mt-1">
                {p.method} &middot; {p.provider} &middot;{' '}
                {p.beneficiary_name ?? '—'}
              </div>
              <div className="text-xs text-ogun-muted mt-1">
                Created {formatIsoDate(p.created_at)}
                {p.final_resolved_at && <> &middot; Resolved {formatIsoDate(p.final_resolved_at)}</>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold">
                KES {recipientAmount.toLocaleString()}
              </span>
              <Badge status={p.status} />
            </div>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Pill label="status" value={p.status} />
            {p.provider_status && <Pill label="provider_status" value={p.provider_status} />}
            <Pill label="fee_model" value={p.fee_model} />
          </div>
        </section>

        {/* Journey stepper */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Payout journey
          </h2>
          <div className="flex items-center gap-0 overflow-x-auto pb-2">
            {PAYOUT_STEPS.map((step, i) => {
              const state = states[i];
              const dotColor =
                state === 'done' ? 'bg-ogun-success' :
                state === 'failed' ? 'bg-ogun-danger' :
                state === 'active' ? 'bg-ogun-accent' :
                'bg-ogun-border';
              const barColor = i > 0 ? (
                states[i - 1] === 'done' && state === 'done' ? 'bg-ogun-success' :
                states[i - 1] === 'done' && state === 'failed' ? 'bg-ogun-danger' :
                'bg-ogun-border'
              ) : '';
              return (
                <div key={step.key} className="flex items-center">
                  {i > 0 && <div className={`w-8 h-0.5 ${barColor}`} />}
                  <div className="flex flex-col items-center min-w-[70px]">
                    <div className={`w-3 h-3 rounded-full ${dotColor}`} />
                    <div className="text-[10px] text-ogun-muted mt-1 text-center whitespace-nowrap">
                      {step.label}
                    </div>
                    <div className="text-[9px] text-ogun-muted">
                      {state}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {stopStep >= 0 && stopReason !== 'in progress' && (
            <div className="mt-3 p-3 rounded-md bg-ogun-bg border border-ogun-border text-sm">
              <span className="text-ogun-warn font-medium">
                Stopped at step {stopStep + 1}: {PAYOUT_STEPS[stopStep].label}
              </span>
              <div className="text-xs text-ogun-muted mt-1">
                {stopReason}
                {p.failure_reason && <> &middot; {p.failure_reason}</>}
                {p.reversal_reason && <> &middot; {p.reversal_reason}</>}
              </div>
            </div>
          )}
        </section>

        {/* Provider detail */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Provider detail
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Kv k="Provider" v={p.provider} />
            <Kv k="Provider reference" v={p.provider_reference} mono />
            <Kv k="Provider transfer code" v={p.provider_transfer_code} mono />
            <Kv k="Provider status" v={p.provider_status} />
            <Kv k="Failure reason" v={p.failure_reason} />
            <Kv k="Reversal reason" v={p.reversal_reason} />
            <Kv k="Created at" v={formatIsoDate(p.created_at)} />
            <Kv k="Final resolved at" v={p.final_resolved_at ? formatIsoDate(p.final_resolved_at) : null} />
            <Kv k="Convergence latency" v={convergenceLatency} />
          </dl>
        </section>

        {/* Wallet impact */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Wallet impact
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-ogun-muted">Wallet reserved</div>
              <div className="font-semibold">
                {walletReserved != null ? `KES ${walletReserved.toLocaleString()}` : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-ogun-muted">Total debit</div>
              <div className="font-semibold">KES {totalDebit.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-ogun-muted">Recipient amount</div>
              <div className="font-semibold">KES {recipientAmount.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-ogun-muted">Fee</div>
              <div className="font-semibold">KES {feeAmount.toLocaleString()}</div>
            </div>
          </div>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm mt-4">
            <Kv k="Fee model" v={p.fee_model} />
            {p.wallet_reserved_at && (
              <Kv k="Wallet reserved at" v={formatIsoDate(p.wallet_reserved_at)} />
            )}
          </dl>
        </section>

        {/* Beneficiary */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Beneficiary
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Kv k="Beneficiary name" v={p.beneficiary_name} />
            <Kv k="Beneficiary type" v={p.beneficiary_type} />
            <Kv k="Bank code" v={p.bank_code} />
            <Kv k="Account number" v={p.beneficiary_account_number} mono />
            <Kv k="Mobile number" v={p.mobile_number} />
            <Kv k="Provider recipient code" v={p.provider_recipient_code} mono />
          </dl>
          {p.beneficiary_id && (
            <div className="mt-3">
              <Link
                href={`/merchants/${id}/beneficiaries/${p.beneficiary_id}`}
                className="text-sm text-ogun-accent-on-dark no-underline"
              >
                View beneficiary &rarr;
              </Link>
            </div>
          )}
        </section>

        {/* Reversal panel */}
        {p.reversal_indicator && (
          <section className="panel-padded mb-6 border-l-4 border-ogun-danger">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-danger mb-4">
              Reversal
            </h2>
            <dl className="grid grid-cols-1 gap-y-3 text-sm">
              <Kv k="Reversal reason" v={p.reversal_reason} />
            </dl>
          </section>
        )}

        {/* Raw fields */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Raw fields
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Kv k="Idempotency key" v={p.idempotency_key} mono />
            <Kv k="External reference" v={p.external_reference} mono />
            <Kv k="Merchant ID" v={p.merchant_id} mono />
            <Kv k="Sub-merchant ID" v={p.sub_merchant_id} mono />
            <Kv k="Beneficiary ID" v={p.beneficiary_id} mono />
          </dl>
          {p.metadata && Object.keys(p.metadata).length > 0 && (
            <>
              <div className="text-xs text-ogun-muted mt-4 mb-1">metadata</div>
              <pre className="text-xs bg-ogun-bg border border-ogun-border rounded-md p-3 overflow-x-auto">
                {JSON.stringify(p.metadata, null, 2)}
              </pre>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-ogun-bg border border-ogun-border">
      <span className="text-ogun-muted">{label}:</span>
      <span className="mono">{value}</span>
    </span>
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
