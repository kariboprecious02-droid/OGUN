import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import {
  createMerchantAsAdmin,
  type CreateMerchantInput,
  kesToCents,
} from '@/lib/api';
import { OnboardingCreateChrome } from '../_components/OnboardingCreateChrome';

function str(v: FormDataEntryValue | null): string | undefined {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : undefined;
}

function num(v: FormDataEntryValue | null): number | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function lines(v: FormDataEntryValue | null): string[] | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const arr = s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

async function handleCreate(formData: FormData): Promise<void> {
  'use server';
  const legalName = str(formData.get('legal_name'));
  const tradingName = str(formData.get('trading_name'));
  if (!legalName || !tradingName || legalName.length < 2 || tradingName.length < 2) {
    redirect('/merchants/onboarding/new?err=missing');
  }

  const address = {
    street: str(formData.get('addr_street')),
    city: str(formData.get('addr_city')),
    county: str(formData.get('addr_county')),
    postal_code: str(formData.get('addr_postal_code')),
  };
  const hasAddress = Object.values(address).some((v) => v !== undefined);

  const contactName = str(formData.get('contact_name'));
  const contactEmail = str(formData.get('contact_email'));
  const contactPhone = str(formData.get('contact_phone'));
  const hasContact = contactName || contactEmail || contactPhone;

  const monthlyKes = num(formData.get('expected_monthly_volume_kes'));
  const ticketKes = num(formData.get('expected_avg_ticket_kes'));

  const input: CreateMerchantInput = {
    legal_name: legalName!,
    trading_name: tradingName!,
    registration_number: str(formData.get('registration_number')),
    tax_id: str(formData.get('tax_id')),
    country: str(formData.get('country')),
    settlement_currency: str(formData.get('settlement_currency')),
    business_category: str(formData.get('business_category')),
    business_address: hasAddress ? address : undefined,
    website_url: str(formData.get('website_url')),
    expected_monthly_volume: monthlyKes !== undefined ? kesToCents(monthlyKes) : undefined,
    expected_avg_ticket: ticketKes !== undefined ? kesToCents(ticketKes) : undefined,
    contact: hasContact
      ? { name: contactName, email: contactEmail, phone: contactPhone }
      : undefined,
    notification_emails: lines(formData.get('notification_emails')),
  };

  let created: { id: string };
  try {
    created = await createMerchantAsAdmin(input);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'create failed');
    redirect(`/merchants/onboarding/new?err=${msg}`);
  }
  redirect(`/merchants/onboarding/${created.id}`);
}

export default async function OnboardingCreatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const params = await searchParams;
  const err = typeof params.err === 'string' ? params.err : null;

  return (
    <OnboardingCreateChrome>
      <div className="max-w-3xl">
        <header className="mb-6">
          <h2 className="text-lg font-semibold">Step 0 — Create merchant</h2>
          <p className="text-sm text-ogun-muted mt-1">
            Start a new merchant record. After submit you will be taken into the
            6-step onboarding wizard: People &amp; Documents, Profile, Settings,
            AI Compliance, Review, and Activate.
          </p>
        </header>

        <div className="panel-padded">
          {err && (
            <div className="text-ogun-danger text-sm mb-4">
              {err === 'missing'
                ? 'Legal name and trading name are required (minimum 2 characters each).'
                : `Failed to create merchant: ${decodeURIComponent(err)}`}
            </div>
          )}

          <form action={handleCreate} className="space-y-6">
            <Section title="Identity">
              <Grid cols={2}>
                <Field label="Legal name *" name="legal_name" required />
                <Field label="Trading name *" name="trading_name" required />
                <Field
                  label="Registration number"
                  name="registration_number"
                  help="Cross-matched against Certificate of Registration"
                />
                <Field
                  label="Tax ID (KRA PIN)"
                  name="tax_id"
                  placeholder="P123456789A"
                  help="Format: P or A, 9 digits, capital letter"
                />
              </Grid>
            </Section>

            <Section title="Jurisdiction & settlement">
              <Grid cols={3}>
                <Field
                  label="Country (ISO-2)"
                  name="country"
                  defaultValue="KE"
                  maxLength={2}
                />
                <Field
                  label="Settlement currency (ISO-3)"
                  name="settlement_currency"
                  defaultValue="KES"
                  maxLength={3}
                />
                <Field
                  label="Business category"
                  name="business_category"
                  placeholder="retail"
                />
              </Grid>
            </Section>

            <Section title="Business address">
              <Grid cols={2}>
                <Field label="Street" name="addr_street" />
                <Field label="City" name="addr_city" />
                <Field label="County / region" name="addr_county" />
                <Field label="Postal code" name="addr_postal_code" />
              </Grid>
            </Section>

            <Section title="Volume expectations (in KES)">
              <Grid cols={2}>
                <Field
                  label="Expected monthly volume"
                  name="expected_monthly_volume_kes"
                  type="number"
                  placeholder="1000000"
                  help="Gross processing volume per month, in KES"
                />
                <Field
                  label="Expected average ticket"
                  name="expected_avg_ticket_kes"
                  type="number"
                  placeholder="2500"
                  help="Average transaction size, in KES"
                />
              </Grid>
            </Section>

            <Section title="Web">
              <Field
                label="Website URL"
                name="website_url"
                type="url"
                placeholder="https://..."
              />
            </Section>

            <Section title="Primary contact">
              <Grid cols={3}>
                <Field label="Name" name="contact_name" />
                <Field label="Email" name="contact_email" type="email" />
                <Field label="Phone" name="contact_phone" />
              </Grid>
            </Section>

            <Section title="Notification emails">
              <label
                htmlFor="notification_emails"
                className="block text-sm text-ogun-muted mb-1"
              >
                Addresses that receive platform alerts (one per line or comma-separated)
              </label>
              <textarea
                id="notification_emails"
                name="notification_emails"
                rows={3}
                placeholder="ops@example.com&#10;finance@example.com"
                className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent outline-none text-sm"
              />
            </Section>

            <div className="flex items-center gap-3 pt-4 border-t border-ogun-border">
              <button type="submit" className="btn btn-primary">
                Create &amp; continue to wizard →
              </button>
              <Link href="/compliance" className="btn">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </OnboardingCreateChrome>
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
    <div>
      <h3 className="text-sm font-semibold text-ogun-muted uppercase tracking-wide mb-3">
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
  required,
  placeholder,
  maxLength,
  help,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  help?: string;
  defaultValue?: string;
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
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent outline-none text-sm"
      />
      {help && <p className="text-xs text-ogun-muted mt-1">{help}</p>}
    </div>
  );
}
