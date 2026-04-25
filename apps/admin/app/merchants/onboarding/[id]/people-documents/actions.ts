'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { uploadMerchantDocument } from '@/lib/api';
import { ALL_DOC_TYPES as DOC_TYPES, type DocType } from '../../_lib/steps';

/**
 * Upload a single compliance document for the given merchant. Server Action
 * with FormData passthrough — no JSON intermediate.
 */
export async function uploadDocAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  const docType = String(formData.get('type') ?? '') as DocType;
  const subId = String(formData.get('sub_merchant_id') ?? '');
  if (!merchantId) {
    redirect('/compliance');
  }
  if (!DOC_TYPES.includes(docType)) {
    redirect(`/merchants/onboarding/${merchantId}/people-documents?err=invalid-type`);
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/merchants/onboarding/${merchantId}/people-documents?err=missing-file`);
  }

  const upload = new FormData();
  upload.append('file', file);
  upload.append('type', docType);
  if (subId) upload.append('sub_merchant_id', subId);

  try {
    await uploadMerchantDocument(merchantId, upload);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'upload failed');
    redirect(`/merchants/onboarding/${merchantId}/people-documents?err=${msg}`);
  }

  revalidatePath(`/merchants/onboarding/${merchantId}/people-documents`);
  redirect(`/merchants/onboarding/${merchantId}/people-documents?ok=${docType}`);
}
