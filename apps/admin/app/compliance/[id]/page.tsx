import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { Badge, formatIsoDate } from '@/components/Badge';
import {
  getMerchantDetail,
  submitComplianceDecision,
  activateMerchant,
  OgunApiError,
} from '@/lib/api';

async function submitDecision(formData: FormData): Promise<void> {
  'use server';
  const merchantId = String(formData.get('merchant_id') ?? '');
  const decision = String(formData.get('decision') ?? '') as
    | 'approve'
    | 'changes_requested'
    | 'reject';
  const notes = String(formData.get('notes') ?? '');
  if (!merchantId || !decision) return;
  await submitComplianceDecision(merchantId, decision, notes);
  redirect(`/compliance/${merchantId}`);
}

async function activate(formData: FormData): Promise<void> {
  'use server';
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) return;
  await activateMerchant(merchantId);
  redirect(`/compliance/${merchantId}`);
}

export default async function ComplianceDetailPage({
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
  const { merchant, sub_merchants, documents, rule_results, reviews } = detail;
  const aiReview = reviews.find((r) => r.reviewer_type === 'ai');
  const isReviewable =
    merchant.status === 'under_manual_review' || merchant.status === 'submitted';
  const isApproved = merchant.status === 'approved';

  return (
    <Page
      title={merchant.legal_name}
      subtitle={`${merchant.id} · ${merchant.trading_name} · ${merchant.country}`}
      actions={<Badge status={merchant.status} />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: profile + sub-merchants + documents */}
        <div className="lg:col-span-2 space-y-6">
          <section className="panel-padded">
            <h2 className="text-lg font-semibold mb-4">Profile</h2>
            <dl className="kv">
              <dt>Legal name</dt>
              <dd>{merchant.legal_name}</dd>
              <dt>Registration</dt>
              <dd>{merchant.registration_number ?? '—'}</dd>
              <dt>KRA PIN</dt>
              <dd>{merchant.tax_id ?? '—'}</dd>
              <dt>Contact</dt>
              <dd>
                {merchant.contact_name ?? '—'}
                {merchant.contact_email ? ` · ${merchant.contact_email}` : ''}
              </dd>
              <dt>Phone</dt>
              <dd>{merchant.contact_phone ?? '—'}</dd>
              <dt>Category</dt>
              <dd>{merchant.business_category ?? '—'}</dd>
              <dt>Currency</dt>
              <dd>{merchant.settlement_currency}</dd>
            </dl>
          </section>

          <section className="panel-padded">
            <h2 className="text-lg font-semibold mb-4">Sub-merchants ({sub_merchants.length})</h2>
            {sub_merchants.length === 0 ? (
              <p className="text-ogun-muted text-sm">No sub-merchants registered.</p>
            ) : (
              <table className="table-default">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Code</th>
                    <th>Settlement</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sub_merchants.map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{s.id}</td>
                      <td>{s.name}</td>
                      <td className="text-ogun-muted">{s.code ?? '—'}</td>
                      <td className="text-ogun-muted">{s.settlement_preference ?? '—'}</td>
                      <td>
                        <Badge status={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel-padded">
            <h2 className="text-lg font-semibold mb-4">
              Documents ({documents.length})
            </h2>
            {documents.length === 0 ? (
              <p className="text-ogun-muted text-sm">No documents uploaded.</p>
            ) : (
              <div className="space-y-3">
                {documents.map((d) => (
                  <div key={d.id} className="border border-ogun-border rounded-md p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <strong>{d.type}</strong>
                        <span className="text-ogun-muted text-xs">
                          {formatIsoDate(d.uploaded_at)}
                        </span>
                      </div>
                      {d.extraction_confidence != null && (
                        <span className="text-ogun-muted text-xs">
                          extraction: {Math.round(d.extraction_confidence)}%
                        </span>
                      )}
                    </div>
                    {d.file_hash && (
                      <div className="mono text-xs text-ogun-muted mb-2 truncate">
                        sha256: {d.file_hash}
                      </div>
                    )}
                    {d.extracted_data && Object.keys(d.extracted_data).length > 0 && (
                      <pre className="mono text-xs bg-ogun-bg p-2 rounded overflow-x-auto whitespace-pre">
                        {JSON.stringify(d.extracted_data, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel-padded">
            <h2 className="text-lg font-semibold mb-4">
              Rule engine results ({rule_results.length})
            </h2>
            {rule_results.length === 0 ? (
              <p className="text-ogun-muted text-sm">
                Rules have not run yet. Submit the merchant for review first.
              </p>
            ) : (
              <ul className="space-y-2">
                {rule_results.map((r) => (
                  <li key={r.id} className="flex items-start gap-3">
                    <span
                      className={`badge ${r.passed ? 'badge-successful' : 'badge-failed'} mt-0.5`}
                    >
                      {r.passed ? 'pass' : 'fail'}
                    </span>
                    <div className="flex-1">
                      <div className="font-medium">{r.rule_name}</div>
                      {!r.passed && (
                        <pre className="mono text-xs text-ogun-muted mt-1 whitespace-pre-wrap">
                          {JSON.stringify(r.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right column: AI review + decision form */}
        <div className="space-y-6">
          {aiReview && (
            <section className="panel-padded">
              <h2 className="text-lg font-semibold mb-3">AI recommendation</h2>
              <div className="mb-3">
                <Badge
                  status={
                    aiReview.decision === 'approve'
                      ? 'approved'
                      : aiReview.decision === 'reject'
                        ? 'rejected'
                        : 'under_manual_review'
                  }
                />
                {aiReview.confidence_score != null && (
                  <span className="text-ogun-muted text-sm ml-2">
                    confidence {Math.round(aiReview.confidence_score)}%
                  </span>
                )}
              </div>
              <p className="text-sm mb-3">{aiReview.explanation_summary ?? '—'}</p>
              {Array.isArray(aiReview.flags_raised) && aiReview.flags_raised.length > 0 && (
                <div>
                  <div className="text-xs text-ogun-muted mb-1">Flags</div>
                  <ul className="space-y-1 text-xs">
                    {(
                      aiReview.flags_raised as Array<{
                        issue: string;
                        severity: string;
                        details: string;
                      }>
                    ).map((f, i) => (
                      <li key={i} className="border-l-2 border-ogun-accent-on-dark pl-2">
                        <strong>{f.issue}</strong> <span className="text-ogun-muted">[{f.severity}]</span>
                        <div className="text-ogun-muted">{f.details}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mono text-xs text-ogun-muted mt-3">
                {aiReview.model_identifier ?? 'ai'}
              </div>
            </section>
          )}

          {isReviewable && (
            <section className="panel-padded">
              <h2 className="text-lg font-semibold mb-3">Submit decision</h2>
              <form action={submitDecision} className="space-y-3">
                <input type="hidden" name="merchant_id" value={merchant.id} />
                <div>
                  <label className="block text-xs text-ogun-muted mb-1" htmlFor="decision">
                    Decision
                  </label>
                  <select
                    id="decision"
                    name="decision"
                    required
                    className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border"
                  >
                    <option value="approve">Approve</option>
                    <option value="changes_requested">Request changes</option>
                    <option value="reject">Reject</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-ogun-muted mb-1" htmlFor="notes">
                    Reviewer notes
                  </label>
                  <textarea
                    id="notes"
                    name="notes"
                    rows={4}
                    required
                    className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm font-mono"
                  />
                </div>
                <button type="submit" className="btn btn-primary w-full justify-center">
                  Submit decision
                </button>
              </form>
            </section>
          )}

          {isApproved && (
            <section className="panel-padded">
              <h2 className="text-lg font-semibold mb-3">Activate</h2>
              <p className="text-sm text-ogun-muted mb-3">
                Issue credentials and create wallets for all sub-merchants. This fires the{' '}
                <code>merchant.activated</code> webhook and is irreversible.
              </p>
              <form action={activate}>
                <input type="hidden" name="merchant_id" value={merchant.id} />
                <button type="submit" className="btn btn-primary w-full justify-center">
                  Activate merchant
                </button>
              </form>
            </section>
          )}

          <section className="panel-padded">
            <h2 className="text-lg font-semibold mb-3">Review history</h2>
            {reviews.length === 0 ? (
              <p className="text-ogun-muted text-sm">No reviews recorded.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {reviews.map((r) => (
                  <li key={r.id} className="border-l-2 border-ogun-border pl-3">
                    <div className="flex items-center gap-2">
                      <span className="text-ogun-muted text-xs">
                        {formatIsoDate(r.created_at)}
                      </span>
                      <span className="text-xs uppercase">{r.reviewer_type}</span>
                      <Badge
                        status={
                          r.decision === 'approve'
                            ? 'approved'
                            : r.decision === 'reject'
                              ? 'rejected'
                              : 'under_manual_review'
                        }
                      />
                    </div>
                    {r.notes && <div className="mt-1">{r.notes}</div>}
                    {r.previous_status && r.new_status && (
                      <div className="text-xs text-ogun-muted mt-1">
                        {r.previous_status} → {r.new_status}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="mt-8">
        <Link href="/compliance" className="text-sm">
          ← Back to list
        </Link>
      </div>
    </Page>
  );
}
