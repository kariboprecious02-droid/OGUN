import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, OgunApiError } from '@/lib/api';
import { OnboardingChrome } from '../../_components/OnboardingChrome';
import { Badge, formatIsoDate } from '@/components/Badge';
import { submitDecisionAction } from './actions';

export default async function ReviewStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const ok = typeof sp.ok === 'string' ? sp.ok : null;
  const errMsg = typeof sp.err === 'string' ? sp.err : null;

  let detail;
  try {
    detail = await getMerchantDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  const m = detail.merchant;
  const canDecide = ['under_manual_review', 'submitted', 'under_ai_review'].includes(m.status);
  const isApproved = m.status === 'approved';
  const aiReview = detail.reviews.find((r) => r.reviewer_type === 'ai');

  return (
    <OnboardingChrome merchant={m} merchantId={id} currentStep="review">
      <div className="space-y-6 pt-4">
        <header>
          <h2 className="text-lg font-semibold">Step 5 — Review</h2>
          <p className="text-sm text-ogun-muted mt-1">
            Final human decision. Approve to issue credentials, request changes
            to send the merchant back to the documents step, or reject if this
            merchant cannot be onboarded.
          </p>
        </header>

        {ok && (
          <div className="panel-padded text-sm border border-emerald-700/50 bg-emerald-900/20 text-emerald-200">
            Decision recorded: <span className="mono">{ok}</span>
          </div>
        )}
        {errMsg && (
          <div className="panel-padded text-sm border border-rose-700/50 bg-rose-900/20 text-rose-200">
            {errMsg}
          </div>
        )}

        {/* AI summary block */}
        {aiReview && (
          <section className="panel-padded">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-2">
              AI recommendation
            </h3>
            <div className="flex items-center gap-3 mb-2">
              <Badge status={aiReview.decision} />
              <span className="text-sm text-ogun-muted">
                {aiReview.confidence_score != null
                  ? `${Math.round(aiReview.confidence_score)}% confidence`
                  : 'no confidence reported'}
              </span>
            </div>
            {aiReview.explanation_summary && (
              <p className="text-sm">{aiReview.explanation_summary}</p>
            )}
          </section>
        )}

        {/* Decision form */}
        {canDecide && (
          <section className="panel-padded">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
              Submit decision
            </h3>
            <form action={submitDecisionAction} className="space-y-4">
              <input type="hidden" name="merchant_id" value={id} />
              <div className="flex gap-3">
                {(['approve', 'changes_requested', 'reject'] as const).map((d) => (
                  <label
                    key={d}
                    className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-ogun-border bg-ogun-bg text-sm cursor-pointer"
                  >
                    <input type="radio" name="decision" value={d} required />
                    {d}
                  </label>
                ))}
              </div>
              <div>
                <label htmlFor="notes" className="block text-sm text-ogun-muted mb-1">
                  Notes *
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={4}
                  required
                  maxLength={2000}
                  placeholder="Document basis for the decision..."
                  className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent-on-dark outline-none text-sm"
                />
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn btn-primary">
                  Submit decision
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Already approved — pass to activate */}
        {isApproved && (
          <section className="panel-padded border border-emerald-700/50 bg-emerald-900/20">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-200 mb-2">
              Approved
            </h3>
            <p className="text-sm text-emerald-100/80 mb-4">
              This merchant is approved and ready for activation. Click below
              to issue credentials and create wallets.
            </p>
            <Link
              href={`/merchants/onboarding/${id}/activate`}
              className="btn btn-primary"
            >
              Continue to Activate →
            </Link>
          </section>
        )}

        {/* Past reviews */}
        {detail.reviews.length > 0 && (
          <section className="panel-padded">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
              Review history
            </h3>
            <table className="w-full text-sm">
              <thead className="text-xs text-ogun-muted uppercase">
                <tr>
                  <th className="text-left py-2">Reviewer</th>
                  <th className="text-left py-2">Decision</th>
                  <th className="text-left py-2">Notes</th>
                  <th className="text-left py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {detail.reviews.map((r) => (
                  <tr key={r.id} className="border-t border-ogun-border align-top">
                    <td className="py-2">{r.reviewer_type}</td>
                    <td className="py-2">
                      <Badge status={r.decision} />
                    </td>
                    <td className="py-2 text-ogun-muted">{r.notes ?? '—'}</td>
                    <td className="py-2 text-xs text-ogun-muted">
                      {formatIsoDate(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-ogun-border">
          <Link href={`/merchants/onboarding/${id}/compliance`} className="btn">
            ← Back
          </Link>
          {!canDecide && !isApproved && (
            <Link
              href={`/merchants/onboarding/${id}/activate`}
              className="btn btn-primary"
            >
              Continue to Activate →
            </Link>
          )}
        </div>
      </div>
    </OnboardingChrome>
  );
}
