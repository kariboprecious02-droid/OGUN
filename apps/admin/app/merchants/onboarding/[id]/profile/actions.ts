'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { updateMerchantProfile, kesToCents } from '@/lib/api';

function str(v: FormDataEntryValue | null): string | undefined {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : undefined;
}

function num(v: FormDataEntryValue | null): number | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');

  const monthlyKes = num(formData.get('expected_monthly_volume_kes'));
  const ticketKes = num(formData.get('expected_avg_ticket_kes'));

  if (monthlyKes !== undefined && monthlyKes < 0) {
    redirect(
      `/merchants/onboarding/${merchantId}/profile?err=${encodeURIComponent('Expected monthly volume cannot be negative.')}`,
    );
  }
  if (ticketKes !== undefined && ticketKes < 0) {
    redirect(
      `/merchants/onboarding/${merchantId}/profile?err=${encodeURIComponent('Expected average ticket cannot be negative.')}`,
    );
  }

  const address = {
    street: str(formData.get('addr_street')),
    city: str(formData.get('addr_city')),
    county: str(formData.get('addr_county')),
    postal_code: str(formData.get('addr_postal_code')),
  };
  const hasAddress = Object.values(address).some((v) => v !== undefined);

  const body = {
    legal_name: str(formData.get('legal_name')),
    trading_name: str(formData.get('trading_name')),
    registration_number: str(formData.get('registration_number')),
    tax_id: str(formData.get('tax_id')),
    business_category: str(formData.get('business_category')),
    business_address: hasAddress ? address : undefined,
    website_url: str(formData.get('website_url')),
    expected_monthly_volume: monthlyKes !== undefined ? kesToCents(monthlyKes) : undefined,
    expected_avg_ticket: ticketKes !== undefined ? kesToCents(ticketKes) : undefined,
    contact_name: str(formData.get('contact_name')),
    contact_email: str(formData.get('contact_email')),
    contact_phone: str(formData.get('contact_phone')),
  };

  try {
    await updateMerchantProfile(merchantId, body);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'update failed');
    redirect(`/merchants/onboarding/${merchantId}/profile?err=${msg}`);
  }

  revalidatePath(`/merchants/onboarding/${merchantId}/profile`);
  redirect(`/merchants/onboarding/${merchantId}/settings`);
}
