'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { submitComplianceDecision } from '@/lib/api';

export async function submitDecisionAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  const decision = String(formData.get('decision') ?? '') as
    | 'approve'
    | 'changes_requested'
    | 'reject';
  const notes = String(formData.get('notes') ?? '').trim();

  if (!merchantId) redirect('/compliance');
  if (!['approve', 'changes_requested', 'reject'].includes(decision)) {
    redirect(`/merchants/onboarding/${merchantId}/review?err=invalid-decision`);
  }
  if (!notes) {
    redirect(`/merchants/onboarding/${merchantId}/review?err=missing-notes`);
  }

  try {
    await submitComplianceDecision(merchantId, decision, notes);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'decision failed');
    redirect(`/merchants/onboarding/${merchantId}/review?err=${msg}`);
  }

  revalidatePath(`/merchants/onboarding/${merchantId}/review`);
  if (decision === 'approve') {
    redirect(`/merchants/onboarding/${merchantId}/activate`);
  }
  redirect(`/merchants/onboarding/${merchantId}/review?ok=${decision}`);
}
