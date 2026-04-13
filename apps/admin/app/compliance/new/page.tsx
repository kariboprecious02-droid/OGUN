import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Page } from '@/components/Page';
import { createMerchantAsAdmin, type CreateMerchantInput } from '@/lib/api';

function str(v: FormDataEntryValue | null): string | undefined {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : undefined;
}

function kesToCents(v: FormDataEntryValue | null): number | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const kes = Number(s);
  if (!Number.isFinite(kes) || kes < 0) return undefined;
  return Math.round(kes * 100);
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
    redirect('/compliance/new?err=missing');
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
    expected_monthly_volume: kesToCents(formData.get('expected_monthly_volume_kes')),
    expected_avg_ticket: kesToCents(formData.get('expected_avg_ticket_kes')),
    contact: hasContact
      ? { name: contactName, email: contactEmail, phone: contactPhone }
      : undefined,
    notification_emails: lines(formData.get('notification_emails')),
  };

  try {
    const created = await createMerchantAsAdmin(input);
    redirect(`/compliance/${created.id}`);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'create failed');
    redirect(`/compliance/new?err=${msg}`);
  }
}

export default async function NewMerchantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const err = typeof params.err === 'string' ? params.err : null;

  return (
    <Page
      title="Create merchant"
      subtitle="Start a new merchant record. After creation: add sub-merchants, upload compliance documents, then submit for review."
    >
      <div className="panel-padded max-w-3xl">
        {err && (
          <div className="text-ogun-danger text-sm mb-4">
            {err === 'missing'
              ? 'Legal name and trading name are required (minimum 2 characters each).'
              : `Failed to create merchant: ${decodeURIComponent(err)}`}
          </div>
        )}

        <form action={handleCreate} className="space-y-6">
          {/* ---------- Identity ---------- */}
          <Section title="Identity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            </div>
          </Section>

          {/* ---------- Jurisdiction & settlement ---------- */}
          <Section title="Jurisdiction & settlement">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Country (ISO-2)" name="country" placeholder="KE" maxLength={2} />
              <Field
                label="Settlement currency (ISO-3)"
                name="settlement_currency"
                placeholder="KES"
                maxLength={3}
              />
              <Field label="Business category" name="business_category" placeholder="retail" />
            </div>
          </Section>

          {/* ---------- Business address ---------- */}
          <Section title="Business address">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Street" name="addr_street" />
              <Field label="City" name="addr_city" />
              <Field label="County / region" name="addr_county" />
              <Field label="Postal code" name="addr_postal_code" />
            </div>
          </Section>

          {/* ---------- Volume expectations ---------- */}
          <Section title="Volume expectations (in KES)">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            </div>
          </Section>

          {/* ---------- Web ---------- */}
          <Section title="Web">
            <Field label="Website URL" name="website_url" type="url" placeholder="https://..." />
          </Section>

          {/* ---------- Contact ---------- */}
          <Section title="Primary contact">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Name" name="contact_name" />
              <Field label="Email" name="contact_email" type="email" />
              <Field label="Phone" name="contact_phone" />
            </div>
          </Section>

          {/* ---------- Notification emails ---------- */}
          <Section title="Notification emails">
            <label htmlFor="notification_emails" className="block text-sm text-ogun-muted mb-1">
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
              Create merchant
            </button>
            <Link href="/compliance" className="btn">
              Cancel
            </Link>
            <p className="text-xs text-ogun-muted ml-4">
              Merchant starts in <span className="mono">pending</span> status. Next steps (sub-merchant,
              documents, submit) happen on the detail page.
            </p>
          </div>
        </form>
      </div>
    </Page>
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

function Field({
  label,
  name,
  type = 'text',
  required,
  placeholder,
  maxLength,
  help,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  help?: string;
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
        className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent outline-none text-sm"
      />
      {help && <p className="text-xs text-ogun-muted mt-1">{help}</p>}
    </div>
  );
}
