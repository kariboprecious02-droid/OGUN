import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, OgunApiError, centsToKes } from '@/lib/api';
import { OnboardingChrome } from '../../_components/OnboardingChrome';
import { DirtyFormGuard } from '@/components/DirtyFormGuard';
import { isStepEditable } from '../../_lib/steps';
import { updateProfileAction } from './actions';

export default async function ProfilePage({
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
  const editable = isStepEditable(m.status, 'profile');

  // Document AI extraction status — used to show "auto-filled" hints next to
  // fields that came from uploaded docs.
  const docTypes = new Set(detail.documents.map((d) => d.type));
  const corUploaded = docTypes.has('certificate_of_registration');
  const taxUploaded = docTypes.has('tax_certificate');
  const addrUploaded = docTypes.has('proof_of_address');

  // Cast merchant to widen for fields not in the typed shape (extras come
  // back from the API depending on what's stored).
  const mAny = m as unknown as Record<string, unknown>;
  const address = (mAny.business_address as Record<string, string> | null) ?? {};
  const monthly = mAny.expected_monthly_volume;
  const ticket = mAny.expected_avg_ticket;

  return (
    <DirtyFormGuard>
    <OnboardingChrome merchant={m} merchantId={id} currentStep="profile">
      <div className="space-y-6 pt-4">
        <header>
          <h2 className="text-lg font-semibold">Step 2 — Profile</h2>
          <p className="text-sm text-ogun-muted mt-1">
            Identity, registration, and business details. Fields auto-extracted from
            uploaded documents are pre-filled — review for accuracy and edit if needed.
          </p>
        </header>

        {errMsg && (
          <div className="panel-padded text-sm border border-rose-700/50 bg-rose-900/20 text-rose-200">
            {decodeURIComponent(errMsg)}
          </div>
        )}

        <form action={updateProfileAction} className="space-y-6">
          <input type="hidden" name="merchant_id" value={id} />

          <Section title="Identity">
            <Grid cols={2}>
              <Field
                label="Legal name *"
                name="legal_name"
                defaultValue={m.legal_name ?? ''}
                disabled={!editable}
                hint={corUploaded ? 'Auto-filled from CoR' : undefined}
              />
              <Field
                label="Trading name *"
                name="trading_name"
                defaultValue={m.trading_name ?? ''}
                disabled={!editable}
                hint={corUploaded ? 'Auto-filled from CoR' : undefined}
              />
              <Field
                label="Registration number"
                name="registration_number"
                defaultValue={m.registration_number ?? ''}
                disabled={!editable}
                hint={corUploaded ? 'Auto-filled from CoR' : 'Pending CoR upload'}
              />
              <Field
                label="Tax ID (KRA PIN)"
                name="tax_id"
                defaultValue={m.tax_id ?? ''}
                disabled={!editable}
                hint={taxUploaded ? 'Auto-filled from KRA PIN cert' : 'Pending tax cert upload'}
              />
            </Grid>
          </Section>

          <Section title="Jurisdiction & settlement">
            <Grid cols={3}>
              <Field
                label="Country (ISO-2)"
                name="country"
                defaultValue={m.country ?? ''}
                disabled
                hint="Set at creation"
              />
              <Field
                label="Settlement currency (ISO-3)"
                name="settlement_currency"
                defaultValue={m.settlement_currency ?? 'KES'}
                disabled
                hint="Set at creation"
              />
              <Field
                label="Business category"
                name="business_category"
                defaultValue={m.business_category ?? ''}
                disabled={!editable}
              />
            </Grid>
          </Section>

          <Section title="Business address">
            <Grid cols={2}>
              <Field
                label="Street"
                name="addr_street"
                defaultValue={String(address.street ?? '')}
                disabled={!editable}
                hint={addrUploaded ? 'Auto-filled from proof of address' : undefined}
              />
              <Field
                label="City"
                name="addr_city"
                defaultValue={String(address.city ?? '')}
                disabled={!editable}
              />
              <Field
                label="County / region"
                name="addr_county"
                defaultValue={String(address.county ?? '')}
                disabled={!editable}
              />
              <Field
                label="Postal code"
                name="addr_postal_code"
                defaultValue={String(address.postal_code ?? '')}
                disabled={!editable}
              />
            </Grid>
          </Section>

          <Section title="Volume expectations (KES)">
            <Grid cols={2}>
              <Field
                label="Expected monthly volume"
                name="expected_monthly_volume_kes"
                type="number"
                min="0"
                defaultValue={
                  typeof monthly === 'number' ? String(centsToKes(monthly)) : ''
                }
                disabled={!editable}
                hint="Gross processing volume per month"
              />
              <Field
                label="Expected average ticket"
                name="expected_avg_ticket_kes"
                type="number"
                min="0"
                defaultValue={
                  typeof ticket === 'number' ? String(centsToKes(ticket)) : ''
                }
                disabled={!editable}
                hint="Average transaction size"
              />
            </Grid>
          </Section>

          <Section title="Web">
            <Field
              label="Website URL"
              name="website_url"
              type="url"
              defaultValue={(mAny.website_url as string | null) ?? ''}
              disabled={!editable}
            />
          </Section>

          <Section title="Primary contact">
            <Grid cols={3}>
              <Field
                label="Name"
                name="contact_name"
                defaultValue={m.contact_name ?? ''}
                disabled={!editable}
              />
              <Field
                label="Email"
                name="contact_email"
                type="email"
                defaultValue={m.contact_email ?? ''}
                disabled={!editable}
              />
              <Field
                label="Phone"
                name="contact_phone"
                defaultValue={m.contact_phone ?? ''}
                disabled={!editable}
              />
            </Grid>
          </Section>

          <div className="flex items-center justify-between pt-4 border-t border-ogun-border">
            <Link
              href={`/merchants/onboarding/${id}/people-documents`}
              className="btn"
            >
              ← Back
            </Link>
            {editable ? (
              <button type="submit" className="btn btn-primary">
                Save & continue to Settings →
              </button>
            ) : (
              <Link
                href={`/merchants/onboarding/${id}/settings`}
                className="btn btn-primary"
              >
                Continue to Settings →
              </Link>
            )}
          </div>
        </form>
      </div>
    </OnboardingChrome>
    </DirtyFormGuard>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="panel-padded">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Grid({
  cols,
  children,
}: {
  cols: 2 | 3;
  children: React.ReactNode;
}): React.ReactElement {
  const gridCls = cols === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3';
  return <div className={`grid ${gridCls} gap-4`}>{children}</div>;
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  disabled,
  min,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  disabled?: boolean;
  min?: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div>
      <label htmlFor={name} className="block text-sm text-ogun-muted mb-1">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        disabled={disabled}
        min={min}
        className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent-on-dark outline-none text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {hint && <p className="text-xs text-ogun-muted mt-1">{hint}</p>}
    </div>
  );
}
