import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, OgunApiError } from '@/lib/api';
import { OnboardingChrome } from '../../_components/OnboardingChrome';
import { activateAction } from './actions';

export default async function ActivateStepPage({
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
  const canActivate = ['approved', 'credentials_issued'].includes(m.status);
  const isActive = m.status === 'active';

  // Read once-rendered credentials from the short-lived activation cookie.
  const cookieStore = await cookies();
  const credsCookie = cookieStore.get(`ogun_creds_${id}`);
  let creds: Record<string, string> | null = null;
  if (credsCookie) {
    try {
      creds = JSON.parse(credsCookie.value) as Record<string, string>;
    } catch {
      creds = null;
    }
  }

  return (
    <OnboardingChrome merchant={m} merchantId={id} currentStep="activate">
      <div className="space-y-6 pt-4">
        <header>
          <h2 className="text-lg font-semibold">Step 6 — Activate</h2>
          <p className="text-sm text-ogun-muted mt-1">
            Issue credentials and create wallets. This is the final step —
            after activation the merchant can call the live API.
          </p>
        </header>

        {ok && (
          <div className="panel-padded text-sm border border-emerald-700/50 bg-emerald-900/20 text-emerald-200">
            Merchant activated successfully.
          </div>
        )}
        {errMsg && (
          <div className="panel-padded text-sm border border-rose-700/50 bg-rose-900/20 text-rose-200">
            {decodeURIComponent(errMsg)}
          </div>
        )}

        {/* Credentials — show once */}
        {creds && (
          <section className="panel-padded border border-ogun-accent-on-dark/50">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-accent-on-dark mb-2">
              Credentials issued — copy now
            </h3>
            <p className="text-sm text-ogun-muted mb-4">
              These will not be shown again. Hand them to the merchant via a
              secure channel; rotate from the merchant panel if compromised.
            </p>
            {(['sandbox', 'live'] as const).map((env) => {
              const envCreds = creds[env];
              if (!envCreds || typeof envCreds !== 'object') return null;
              const entries = envCreds as Record<string, string>;
              return (
                <div key={env} className="mb-6">
                  <h4 className="text-sm font-semibold text-ogun-muted mb-2 uppercase">
                    {env} credentials
                  </h4>
                  <div className="space-y-3">
                    {Object.entries(entries).map(([k, v]) => (
                      <div key={k} className="flex flex-col gap-1">
                        <span className="text-xs text-ogun-muted uppercase">{k}</span>
                        <code className="mono text-xs px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border break-all">
                          {String(v)}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* Activate CTA */}
        {canActivate && !isActive && !creds && (
          <section className="panel-padded">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
              Ready to activate
            </h3>
            <form action={activateAction} className="space-y-4">
              <input type="hidden" name="merchant_id" value={id} />
              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <input type="checkbox" required className="mt-1" />
                <span>
                  I confirm that all compliance documents have been reviewed,
                  the AI rule results have been considered, and this merchant
                  is authorised to process live payments.
                </span>
              </label>
              <div className="flex justify-end">
                <button type="submit" className="btn btn-primary">
                  Activate &amp; issue credentials
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Already active */}
        {isActive && (
          <section className="panel-padded border border-emerald-700/50 bg-emerald-900/20">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-200 mb-2">
              Active
            </h3>
            <p className="text-sm text-emerald-100/80 mb-4">
              This merchant is fully onboarded. View their live dashboard for
              collections, payouts, and settlements.
            </p>
            <Link href={`/merchants/${id}`} className="btn btn-primary">
              Open merchant panel →
            </Link>
          </section>
        )}

        {/* Sub-merchants summary */}
        <section className="panel-padded">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Sub-merchants
          </h3>
          {detail.sub_merchants.length === 0 ? (
            <p className="text-sm text-ogun-muted">No sub-merchants.</p>
          ) : (
            <ul className="divide-y divide-ogun-border text-sm">
              {detail.sub_merchants.map((s) => (
                <li key={s.id} className="py-2 flex items-center justify-between">
                  <span>
                    <span className="font-medium">{s.name}</span>
                    {s.code && <span className="ml-2 text-ogun-muted">{s.code}</span>}
                  </span>
                  <span className={`badge badge-${s.status}`}>{s.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex items-center justify-between pt-4 border-t border-ogun-border">
          <Link href={`/merchants/onboarding/${id}/review`} className="btn">
            ← Back
          </Link>
          <Link href="/compliance" className="btn">
            Back to compliance list
          </Link>
        </div>
      </div>
    </OnboardingChrome>
  );
}
