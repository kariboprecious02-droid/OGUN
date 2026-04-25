import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, OgunApiError } from '@/lib/api';
import { OnboardingChrome } from '../../_components/OnboardingChrome';
import { formatIsoDate } from '@/components/Badge';
import { submitForReviewAction } from './actions';

export default async function ComplianceStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const errMsg = typeof sp.err === 'string' ? sp.err : null;

  let detail;
  try {
    detail = await getMerchantDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  const m = detail.merchant;
  const aiReview = detail.reviews.find((r) => r.reviewer_type === 'ai');
  const canSubmit = ['draft', 'changes_requested'].includes(m.status);
  const pipelineRan = ['under_ai_review', 'under_manual_review', 'approved', 'rejected', 'credentials_issued', 'active'].includes(m.status);

  return (
    <OnboardingChrome merchant={m} merchantId={id} currentStep="compliance">
      <div className="space-y-6 pt-4">
        <header>
          <h2 className="text-lg font-semibold">Step 4 — AI Compliance</h2>
          <p className="text-sm text-ogun-muted mt-1">
            The compliance pipeline runs Document AI extraction, deterministic
            rules, and a Claude reasoning pass. Submit when documents and
            profile are ready.
          </p>
        </header>

        {errMsg && (
          <div className="panel-padded text-sm border border-rose-700/50 bg-rose-900/20 text-rose-200">
            {decodeURIComponent(errMsg)}
          </div>
        )}

        {/* Submit CTA */}
        {canSubmit && (
          <section className="panel-padded">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-2">
              Submit for review
            </h3>
            <p className="text-sm text-ogun-muted mb-4">
              Triggers the compliance pipeline. The merchant will transition
              to <span className="mono">submitted</span> → <span className="mono">under_ai_review</span> →
              and either <span className="mono">under_manual_review</span> (manual decision needed)
              or <span className="mono">approved</span> / <span className="mono">changes_requested</span> /
              <span className="mono"> rejected</span>.
            </p>
            <form action={submitForReviewAction}>
              <input type="hidden" name="merchant_id" value={id} />
              <button type="submit" className="btn btn-primary">
                Run compliance pipeline
              </button>
            </form>
          </section>
        )}

        {/* Rule results */}
        {pipelineRan && (
          <section className="panel-padded">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
              Rule results
            </h3>
            {detail.rule_results.length === 0 ? (
              <p className="text-sm text-ogun-muted">No rule results yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-ogun-muted uppercase">
                  <tr>
                    <th className="text-left py-2">Rule</th>
                    <th className="text-left py-2">Outcome</th>
                    <th className="text-left py-2">Run at</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rule_results.map((r) => (
                    <tr key={r.id} className="border-t border-ogun-border">
                      <td className="py-2 mono">{r.rule_name}</td>
                      <td className="py-2">
                        <span className={`badge badge-${r.passed ? 'active' : 'rejected'}`}>
                          {r.passed ? 'pass' : 'fail'}
                        </span>
                      </td>
                      <td className="py-2 text-ogun-muted text-xs">
                        {formatIsoDate(r.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* AI review summary */}
        {aiReview && (
          <section className="panel-padded">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
              AI reasoning summary
            </h3>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-ogun-muted">Decision</dt>
                <dd>{aiReview.decision}</dd>
              </div>
              <div>
                <dt className="text-xs text-ogun-muted">Confidence</dt>
                <dd>
                  {aiReview.confidence_score != null
                    ? `${Math.round(aiReview.confidence_score * 100)}%`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ogun-muted">Model</dt>
                <dd className="mono text-xs">{aiReview.model_identifier ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ogun-muted">Run at</dt>
                <dd className="text-xs">{formatIsoDate(aiReview.created_at)}</dd>
              </div>
              {aiReview.explanation_summary && (
                <div className="md:col-span-2">
                  <dt className="text-xs text-ogun-muted">Explanation</dt>
                  <dd className="mt-1 text-sm">{aiReview.explanation_summary}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-ogun-border">
          <Link href={`/merchants/onboarding/${id}/settings`} className="btn">
            ← Back
          </Link>
          <Link
            href={`/merchants/onboarding/${id}/review`}
            className="btn btn-primary"
          >
            Continue to Review →
          </Link>
        </div>
      </div>
    </OnboardingChrome>
  );
}
