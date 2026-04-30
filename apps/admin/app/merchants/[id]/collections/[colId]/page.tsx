import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getCollectionDetail, getMerchantDetail, OgunApiError, centsToKes } from '@/lib/api';
import { Nav } from '@/components/Nav';
import { Badge, formatIsoDate } from '@/components/Badge';

const JOURNEY_STEPS = [
  { key: 'created', label: 'Created' },
  { key: 'sent', label: 'Sent to provider' },
  { key: 'accepted', label: 'Provider accepted' },
  { key: 'paid', label: 'Customer paid' },
  { key: 'credited', label: 'Wallet credited' },
  { key: 'eligible', label: 'Settlement eligible' },
  { key: 'settled', label: 'Settled' },
] as const;

type StepState = 'done' | 'active' | 'failed' | 'pending';

function deriveStepStates(c: Awaited<ReturnType<typeof getCollectionDetail>>): {
  states: StepState[];
  stopStep: number;
  stopReason: string;
} {
  const states: StepState[] = new Array(7).fill('pending');
  let stopStep = -1;
  let stopReason = '';

  if (c.created_at) states[0] = 'done';

  if (c.provider_submission_at) {
    states[1] = 'done';
  } else if (c.provider_call_state === 'timed_out') {
    states[1] = 'failed';
    stopStep = 1;
    stopReason = `provider_call_state = timed_out`;
  }

  if (c.provider_reference) {
    states[2] = 'done';
  } else if (states[1] === 'done' || states[1] === 'failed') {
    states[2] = 'failed';
    if (stopStep < 0) { stopStep = 2; stopReason = 'provider_reference is null'; }
  }

  if (c.business_status === 'successful' || c.business_status === 'refunded') {
    states[3] = 'done';
  } else if (c.business_status === 'failed') {
    states[3] = 'failed';
    if (stopStep < 0) { stopStep = 3; stopReason = c.status_reason ?? 'failed'; }
  }

  if (c.wallet_credited) states[4] = 'done';
  if (c.settlement_eligible) states[5] = 'done';
  if (c.settlement_batch_id) states[6] = 'done';

  if (stopStep < 0) {
    for (let i = 0; i < 7; i++) {
      if (states[i] === 'pending') { stopStep = i; stopReason = 'in progress'; break; }
    }
  }

  return { states, stopStep, stopReason };
}

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string; colId: string }>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id, colId } = await params;

  let detail;
  let c;
  try {
    [detail, c] = await Promise.all([
      getMerchantDetail(id),
      getCollectionDetail(colId),
    ]);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  const { states, stopStep, stopReason } = deriveStepStates(c);
  const gross = centsToKes(c.amount);
  const fee = centsToKes(c.fee_amount);
  const customerPaid = centsToKes(c.customer_amount);
  const net = gross - fee;

  return (
    <div className="min-h-screen bg-ogun-bg text-ogun-text">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-4">
          <Link
            href={`/merchants/${id}/collections`}
            className="text-sm text-ogun-accent-on-dark no-underline"
          >
            &larr; Back to collections
          </Link>
        </div>

        {/* Header strip */}
        <section className="panel-padded mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-lg font-semibold mono">{c.id}</h1>
              <div className="text-sm text-ogun-muted mt-1">
                {c.method} &middot; {c.provider} &middot;{' '}
                {c.customer_phone} &middot; ref: {c.merchant_reference ?? '—'}
              </div>
              <div className="text-xs text-ogun-muted mt-1">
                Created {formatIsoDate(c.created_at)}
                {c.final_resolved_at && <> &middot; Resolved {formatIsoDate(c.final_resolved_at)}</>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold">
                KES {gross.toLocaleString()}
              </span>
              <Badge status={c.business_status} />
            </div>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Pill label="business_status" value={c.business_status} />
            <Pill label="internal_status" value={c.internal_status} />
            {c.provider_call_state && <Pill label="provider_call_state" value={c.provider_call_state} />}
          </div>
        </section>

        {/* Journey stepper */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Transaction journey
          </h2>
          <div className="flex items-center gap-0 overflow-x-auto pb-2">
            {JOURNEY_STEPS.map((step, i) => {
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
          {stopStep >= 0 && (
            <div className="mt-3 p-3 rounded-md bg-ogun-bg border border-ogun-border text-sm">
              <span className="text-ogun-warn font-medium">
                Stopped at step {stopStep + 1}: {JOURNEY_STEPS[stopStep].label}
              </span>
              <div className="text-xs text-ogun-muted mt-1">
                {stopReason}
                {c.provider_message && <> &middot; {c.provider_message}</>}
                {c.status_reason && <> &middot; {c.status_reason}</>}
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
            <Kv k="Provider" v={c.provider} />
            <Kv k="Provider reference" v={c.provider_reference} mono />
            <Kv k="Provider call state" v={c.provider_call_state} />
            <Kv k="Provider message" v={c.provider_message ?? c.status_reason} />
            <Kv k="Failure reason" v={c.failure_reason ?? c.status_reason} />
            <Kv k="Submission at" v={c.provider_submission_at ? formatIsoDate(c.provider_submission_at) : null} />
            <Kv k="Webhook received" v={c.webhook_received_at ? formatIsoDate(c.webhook_received_at) : null} />
            <Kv k="Poll attempts" v={c.poll_attempt_count} />
            <Kv k="Polling stop reason" v={c.polling_stop_reason} />
            <Kv k="Resolution time" v={
              c.created_at && c.final_resolved_at
                ? `${((new Date(c.final_resolved_at).getTime() - new Date(c.created_at).getTime()) / 1000).toFixed(1)}s`
                : null
            } />
          </dl>
        </section>

        {/* Wallet impact */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Wallet impact
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-ogun-muted">Gross</div>
              <div className="font-semibold">KES {gross.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-ogun-muted">Fee</div>
              <div className="font-semibold">KES {fee.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-ogun-muted">Customer paid</div>
              <div className="font-semibold">KES {customerPaid.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-ogun-muted">Net</div>
              <div className="font-semibold">KES {net.toLocaleString()}</div>
            </div>
          </div>
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm mt-4">
            <Kv k="Wallet credited" v={c.wallet_credited ? 'yes' : 'no'} />
            <Kv k="Wallet credited at" v={c.wallet_credited_at ? formatIsoDate(c.wallet_credited_at) : null} />
            <Kv k="Settlement eligible" v={c.settlement_eligible ? 'yes' : 'no'} />
            <Kv k="Settlement batch" v={c.settlement_batch_id} mono />
            <Kv k="Refund status" v={c.refund_status} />
            <Kv k="Refunded amount" v={c.refunded_amount != null ? `KES ${centsToKes(c.refunded_amount).toLocaleString()}` : null} />
          </dl>
        </section>

        {/* Raw data */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Raw fields
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Kv k="Idempotency key" v={c.idempotency_key} mono />
            <Kv k="Customer name" v={c.customer_name} />
            <Kv k="Customer email" v={c.customer_email} />
            <Kv k="Customer phone" v={c.customer_phone} />
            <Kv k="Merchant ID" v={c.merchant_id} mono />
            <Kv k="Sub-merchant ID" v={c.sub_merchant_id} mono />
          </dl>
          {c.metadata && Object.keys(c.metadata).length > 0 && (
            <pre className="mt-4 text-xs bg-ogun-bg border border-ogun-border rounded-md p-3 overflow-x-auto">
              {JSON.stringify(c.metadata, null, 2)}
            </pre>
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
