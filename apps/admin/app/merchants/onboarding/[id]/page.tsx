import { redirect, notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, OgunApiError } from '@/lib/api';
import { deriveStepFromStatus } from '../_lib/steps';

/**
 * `/merchants/onboarding/[id]` — entry point. Derives the current wizard
 * step from `merchant.status` and redirects to that segment so the user
 * always lands at the right place.
 */
export default async function OnboardingEntry({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  await requireAuth();
  const { id } = await params;
  let detail;
  try {
    detail = await getMerchantDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }
  const step = deriveStepFromStatus(detail.merchant.status);
  redirect(`/merchants/onboarding/${id}/${step}`);
}
