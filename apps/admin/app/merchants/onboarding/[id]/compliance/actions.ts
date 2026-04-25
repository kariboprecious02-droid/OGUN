'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { submitMerchantForReview } from '@/lib/api';

export async function submitForReviewAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');

  try {
    await submitMerchantForReview(merchantId);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'submit failed');
    redirect(`/merchants/onboarding/${merchantId}/compliance?err=${msg}`);
  }

  revalidatePath(`/merchants/onboarding/${merchantId}/compliance`);
  redirect(`/merchants/onboarding/${merchantId}/review`);
}
