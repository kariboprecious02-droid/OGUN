import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getPayoutDetail, getPayoutLogs, getMerchantDetail, OgunApiError, centsToKes } from '@/lib/api';
import type { PayoutDetail, PayoutLogs } from '@/lib/api';
import { Nav } from '@/components/Nav';
import { Badge, formatIsoDate } from '@/components/Badge';
import { SyncButton } from './_components/SyncButton';

/* ── Stepper: 9-state machine ─────────────────────────────────────── */

const BASELINE_STEPS = [
  { key: 'created',    label: 'Created' },
  { key: 'queued',     label: 'Queued' },
  { key: 'processing', label: 'Provider processing' },
  { key: 'terminal',   label: 'Terminal' },
] as const;

const BRANCH_NODES: Record<string, { key: string; label: string }> = {
  pending_approval:     { key: 'pending_approval',     label: 'Awaiting approval' },
  pending_confirmation: { key: 'pending_confirmation', label: 'Awaiting confirmation' },
};

const REVERSAL_NODE = { key: 'reversed', label: 'Reversed' };

type StepState = 'done' | 'active' | 'failed' | 'cancelled' | 'reversed' | 'pending';

type StepNode = { key: string; label: string; state: StepState };

const PAST_PROCESSING = [
  'pending_approval', 'pending_confirmation',
  'succeeded', 'failed', 'cancelled', 'reversed',
];

function buildStepperNodes(p: PayoutDetail): {
  nodes: StepNode[];
  callout: { step: number; label: string; reason: string } | null;
} {
  const nodes: StepNode[] = [];

  // Step 0: Created
  nodes.push({ key: 'created', label: 'Created', state: 'done' });

  // Step 1: Queued
  if (p.status === 'created') {
    nodes.push({ key: 'queued', label: 'Queued', state: 'active' });
  } else {
    nodes.push({ key: 'queued', label: 'Queued', state: 'done' });
  }

  // Step 2: Processing
  if (['created', 'queued'].includes(p.status)) {
    nodes.push({ key: 'processing', label: 'Provider processing', state: 'pending' });
  } else if (p.status === 'processing') {
    nodes.push({ key: 'processing', label: 'Provider processing', state: 'active' });
  } else {
    nodes.push({ key: 'processing', label: 'Provider processing', state: 'done' });
  }

  // Branch node (conditional — only render when status hits it)
  if (p.status === 'pending_approval' || p.status === 'pending_confirmation') {
    const branch = BRANCH_NODES[p.status];
    nodes.push({ key: branch.key, label: branch.label, state: 'active' });
  }

  // Terminal node
  const terminalIndex = nodes.length;
  if (p.status === 'succeeded' || p.status === 'reversed') {
    nodes.push({ key: 'terminal', label: 'Succeeded', state: 'done' });
  } else if (p.status === 'failed') {
    nodes.push({ key: 'terminal', label: 'Failed', state: 'failed' });
  } else if (p.status === 'cancelled') {
    nodes.push({ key: 'terminal', label: 'Cancelled', state: 'cancelled' });
  } else {
    nodes.push({ key: 'terminal', label: 'Terminal', state: 'pending' });
  }

  // Reversal append node
  if (p.status === 'reversed' || p.reversal_indicator) {
    nodes.push({ key: 'reversed', label: 'Reversed', state: 'reversed' });
  }

  // Build callout
  let callout: { step: number; label: string; reason: string } | null = null;
  if (p.status === 'failed') {
    callout = { step: terminalIndex, label: 'Failed', reason: p.failure_reason ?? 'failed' };
  } else if (p.status === 'cancelled') {
    callout = { step: terminalIndex, label: 'Cancelled', reason: 'Payout was cancelled before reaching the provider' };
  } else if (p.status === 'reversed' || p.reversal_indicator) {
    callout = { step: nodes.length - 1, label: 'Reversed', reason: p.reversal_reason ?? 'reversed by provider' };
  }

  return { nodes, callout };
}

function dotColor(state: StepState): string {
  switch (state) {
    case 'done':      return 'bg-ogun-success';
    case 'active':    return 'bg-ogun-accent';
    case 'failed':    return 'bg-ogun-danger';
    case 'cancelled': return 'bg-ogun-muted border border-dashed border-ogun-border';
    case 'reversed':  return 'bg-ogun-warn';
    case 'pending':   return 'bg-ogun-border';
  }
}

function barColor(prev: StepState, curr: StepState): string {
  if (prev === 'done' && curr === 'done') return 'bg-ogun-success';
  if (prev === 'done' && curr === 'failed') return 'bg-ogun-danger';
  if (prev === 'done' && curr === 'reversed') return 'bg-ogun-warn';
  if (prev === 'done' && curr === 'cancelled') return 'bg-ogun-muted';
  if (prev === 'done' && curr === 'active') return 'bg-ogun-accent';
  return 'bg-ogun-border';
}

const TERMINAL_STATUSES = ['succeeded', 'failed', 'reversed', 'cancelled'];

/* ── Page ─────────────────────────────────────────────────────────── */

export default async function PayoutDetailPage({
  params,
}: {
  params: Promise<{ id: string; payoutId: string }>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id, payoutId } = await params;

  let detail;
  let p: PayoutDetail;
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

  const logs = await getPayoutLogs(payoutId).catch((): PayoutLogs => ({
    lifecycle: [],
    paystack_inbound: [],
    webhook_deliveries: [],
  }));

  const { nodes, callout } = buildStepperNodes(p);
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
            {nodes.map((node, i) => (
              <div key={node.key} className="flex items-center">
                {i > 0 && <div className={`w-8 h-0.5 ${barColor(nodes[i - 1].state, node.state)}`} />}
                <div className="flex flex-col items-center min-w-[70px]">
                  <div className={`w-3 h-3 rounded-full ${dotColor(node.state)}`} />
                  <div className="text-[10px] text-ogun-muted mt-1 text-center whitespace-nowrap">
                    {node.label}
                  </div>
                  <div className="text-[9px] text-ogun-muted">
                    {node.state}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {callout && (
            <div className={`mt-3 p-3 rounded-md border text-sm ${
              callout.label === 'Cancelled'
                ? 'bg-ogun-bg border-ogun-border'
                : callout.label === 'Reversed'
                  ? 'bg-ogun-bg border-ogun-warn'
                  : 'bg-ogun-bg border-ogun-danger'
            }`}>
              <span className={`font-medium ${
                callout.label === 'Cancelled'
                  ? 'text-ogun-muted'
                  : callout.label === 'Reversed'
                    ? 'text-ogun-warn'
                    : 'text-ogun-danger'
              }`}>
                {callout.label} at step {callout.step + 1}
              </span>
              <div className="text-xs text-ogun-muted mt-1">{callout.reason}</div>
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

        {/* Integration Logs */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Integration logs
          </h2>

          <>
            {/* (a) Lifecycle events */}
            <div className="text-xs text-ogun-muted mb-2">
              API calls &amp; lifecycle events ({logs.lifecycle.length})
            </div>
            {logs.lifecycle.length === 0 ? (
              <p className="text-xs text-ogun-muted mb-4 p-2 bg-ogun-bg rounded-md border border-ogun-border">
                No lifecycle events captured for this payout. Events will appear
                for new payouts after the observability layer deploys.
              </p>
            ) : (
              <div className="overflow-x-auto mb-4 space-y-0">
                {logs.lifecycle.map((e) => (
                  <details key={e.id} className="border-t border-ogun-border group">
                    <summary className="flex items-center gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-ogun-bg/50 list-none">
                      <span className="whitespace-nowrap text-ogun-muted w-[140px]">{formatIsoDate(e.occurred_at)}</span>
                      {e.payload?.direction ? (
                        <span className="w-[120px] font-medium text-ogun-accent-on-dark text-[10px]">{String(e.payload.direction)}</span>
                      ) : null}
                      <span className="mono font-medium w-[130px]">{e.event_type}</span>
                      <span className="flex-1 text-ogun-muted truncate">{e.message ?? '—'}</span>
                      <span className="text-ogun-accent-on-dark text-[10px]">&#9654;</span>
                    </summary>
                    <div className="px-3 py-2 bg-ogun-bg border-l-2 border-ogun-accent-on-dark ml-3">
                      <div className="text-[10px] text-ogun-muted uppercase mb-1">
                        {e.payload?.direction ? String(e.payload.direction) : 'Payload'}
                      </div>
                      <pre className="text-xs mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
                    </div>
                  </details>
                ))}
              </div>
            )}

              {/* (b) Inbound Paystack webhooks */}
              <div className="text-xs text-ogun-muted mb-2">
                Inbound Paystack webhooks ({logs.paystack_inbound.length})
              </div>
              {logs.paystack_inbound.length === 0 ? (
                <p className="text-xs text-ogun-muted mb-4 p-2 bg-ogun-bg rounded-md border border-ogun-border">
                  No inbound webhooks received from Paystack for this payout.
                </p>
              ) : (
                <div className="overflow-x-auto mb-4 space-y-0">
                  {logs.paystack_inbound.map((w) => (
                    <details key={w.id} className="border-t border-ogun-border">
                      <summary className="flex items-center gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-ogun-bg/50 list-none">
                        <span className="whitespace-nowrap text-ogun-muted w-[160px]">{formatIsoDate(w.received_at)}</span>
                        <span className="mono font-medium w-[140px]">{w.event_type}</span>
                        <span className="w-[80px]">{w.signature_valid ? '✓ valid' : '✗ invalid'}</span>
                        <span className="w-[50px]">{w.http_status_returned}</span>
                        <span className="flex-1 text-ogun-accent-on-dark text-[10px]">&#9654; View payload</span>
                      </summary>
                      <div className="px-3 py-2 bg-ogun-bg border-l-2 border-ogun-accent-on-dark ml-3">
                        <pre className="text-xs mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
                          {JSON.stringify(w.raw_payload, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              )}

              {/* (c) Outbound merchant webhooks */}
              {logs.webhook_deliveries.length > 0 && (
                <>
                  <div className="text-xs text-ogun-muted mb-2">
                    Outbound merchant webhooks ({logs.webhook_deliveries.length})
                  </div>
                  <div className="overflow-x-auto mb-4 space-y-0">
                    {logs.webhook_deliveries.map((d) => (
                      <details key={d.id} className="border-t border-ogun-border">
                        <summary className="flex items-center gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-ogun-bg/50 list-none">
                          <span className="whitespace-nowrap text-ogun-muted w-[160px]">{formatIsoDate(d.created_at)}</span>
                          <span className="mono font-medium w-[140px]">{d.event_type}</span>
                          <span className="mono text-ogun-muted w-[180px] truncate">{d.url}</span>
                          <span className="w-[80px]"><Badge status={d.delivery_status} /></span>
                          <span className="w-[40px]">{d.http_status ?? '—'}</span>
                          <span className="w-[50px]">&times;{d.retry_count}</span>
                          <span className="flex-1 text-ogun-accent-on-dark text-[10px]">&#9654; View payload</span>
                        </summary>
                        <div className="px-3 py-2 bg-ogun-bg border-l-2 border-ogun-accent-on-dark ml-3">
                          <div className="text-[10px] text-ogun-muted uppercase mb-1">Event payload sent to merchant</div>
                          <pre className="text-xs mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
                            {JSON.stringify(d.payload, null, 2)}
                          </pre>
                          {d.response_body && (
                            <>
                              <div className="text-[10px] text-ogun-muted uppercase mt-2 mb-1">Merchant response</div>
                              <pre className="text-xs mono overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
                                {d.response_body}
                              </pre>
                            </>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                </>
              )}
          </>
        </section>

        {/* Operational actions */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Operational actions
          </h2>
          <SyncButton payoutId={p.id} disabled={TERMINAL_STATUSES.includes(p.status)} />
          {TERMINAL_STATUSES.includes(p.status) && (
            <p className="text-xs text-ogun-muted mt-2">
              Sync is disabled because this payout is already terminal ({p.status}).
            </p>
          )}
        </section>

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
