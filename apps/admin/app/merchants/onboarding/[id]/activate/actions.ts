'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { activateMerchant } from '@/lib/api';

const CRED_COOKIE_PREFIX = 'ogun_creds_';

/**
 * Activate the merchant. Backend issues credentials atomically and returns
 * them in the response. Stash the credentials in a short-lived httpOnly
 * cookie (5 min) so the activate page can show them once on the redirect
 * landing — backend does not re-issue or echo creds on subsequent calls.
 */
export async function activateAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');

  let resp;
  try {
    resp = await activateMerchant(merchantId);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'activation failed');
    redirect(`/merchants/onboarding/${merchantId}/activate?err=${msg}`);
  }

  const creds = (resp as unknown as { credentials?: Record<string, string> }).credentials;
  if (creds) {
    const cookieStore = await cookies();
    cookieStore.set(`${CRED_COOKIE_PREFIX}${merchantId}`, JSON.stringify(creds), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 5, // 5 minutes
    });
  }

  revalidatePath(`/merchants/onboarding/${merchantId}/activate`);
  redirect(`/merchants/onboarding/${merchantId}/activate?ok=activated`);
}
