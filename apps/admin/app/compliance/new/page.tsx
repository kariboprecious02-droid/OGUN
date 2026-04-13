import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Page } from '@/components/Page';
import { createMerchantAsAdmin } from '@/lib/api';

async function handleCreate(formData: FormData): Promise<void> {
  'use server';
  const legalName = String(formData.get('legal_name') ?? '').trim();
  const tradingName = String(formData.get('trading_name') ?? '').trim();
  if (legalName.length < 2 || tradingName.length < 2) {
    redirect('/compliance/new?err=missing');
  }

  const country = String(formData.get('country') ?? '').trim() || undefined;
  const settlementCurrency = String(formData.get('settlement_currency') ?? '').trim() || undefined;
  const businessCategory = String(formData.get('business_category') ?? '').trim() || undefined;
  const websiteUrl = String(formData.get('website_url') ?? '').trim() || undefined;
  const contactName = String(formData.get('contact_name') ?? '').trim() || undefined;
  const contactEmail = String(formData.get('contact_email') ?? '').trim() || undefined;
  const contactPhone = String(formData.get('contact_phone') ?? '').trim() || undefined;

  const contact =
    contactName || contactEmail || contactPhone
      ? { name: contactName, email: contactEmail, phone: contactPhone }
      : undefined;

  try {
    const created = await createMerchantAsAdmin({
      legal_name: legalName,
      trading_name: tradingName,
      country,
      settlement_currency: settlementCurrency,
      business_category: businessCategory,
      website_url: websiteUrl,
      contact,
    });
    redirect(`/compliance/${created.id}`);
  } catch (err) {
    // Next.js uses exceptions to implement redirect; rethrow those
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
      subtitle="Manually onboard a new merchant. The record will start in 'pending' and move through the compliance pipeline."
    >
      <div className="panel-padded max-w-2xl">
        {err && (
          <div className="text-ogun-danger text-sm mb-4">
            {err === 'missing'
              ? 'Legal name and trading name are required.'
              : `Failed to create merchant: ${decodeURIComponent(err)}`}
          </div>
        )}

        <form action={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Legal name *" name="legal_name" required />
            <Field label="Trading name *" name="trading_name" required />
            <Field label="Country (ISO-2)" name="country" placeholder="KE" maxLength={2} />
            <Field
              label="Settlement currency (ISO-3)"
              name="settlement_currency"
              placeholder="KES"
              maxLength={3}
            />
            <Field label="Business category" name="business_category" placeholder="retail" />
            <Field label="Website URL" name="website_url" type="url" placeholder="https://..." />
          </div>

          <div className="border-t border-ogun-border pt-4">
            <h3 className="text-sm font-semibold text-ogun-muted mb-3">
              Primary contact (optional)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Name" name="contact_name" />
              <Field label="Email" name="contact_email" type="email" />
              <Field label="Phone" name="contact_phone" />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-4">
            <button type="submit" className="btn btn-primary">
              Create merchant
            </button>
            <Link href="/compliance" className="btn">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </Page>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required,
  placeholder,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
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
    </div>
  );
}
