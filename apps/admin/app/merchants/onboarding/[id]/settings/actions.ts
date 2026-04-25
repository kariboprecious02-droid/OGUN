'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  patchMerchantSettings,
  patchSubMerchantSettings,
  createSubMerchantAsAdmin,
  type SettingsBody,
} from '@/lib/api';

const ENABLED_METHOD_OPTIONS = ['mpesa', 'airtel', 'till', 'card', 'bank'];

function num(v: FormDataEntryValue | null): number | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function rejectNegatives(
  fields: Array<{ name: string; value: number | undefined }>,
): string | null {
  for (const f of fields) {
    if (f.value !== undefined && f.value < 0) {
      return `${f.name} cannot be negative.`;
    }
  }
  return null;
}

function emails(v: FormDataEntryValue | null): string[] | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const arr = s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

export async function saveMerchantSettingsAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');

  const collection_fee_pct = num(formData.get('collection_fee_pct'));
  const payout_fee_pct = num(formData.get('payout_fee_pct'));
  const settlement_fee_pct = num(formData.get('settlement_fee_pct'));

  const negErr = rejectNegatives([
    { name: 'Collection fee %', value: collection_fee_pct },
    { name: 'Payout fee %', value: payout_fee_pct },
    { name: 'Settlement fee %', value: settlement_fee_pct },
  ]);
  if (negErr) {
    redirect(`/merchants/onboarding/${merchantId}/settings?err=${encodeURIComponent(negErr)}`);
  }

  const enabled_methods = ENABLED_METHOD_OPTIONS.filter(
    (m) => String(formData.get(`method_${m}`) ?? '') === 'on',
  );

  const body: SettingsBody = {
    collection_fee_pct,
    collection_fee_model: (String(formData.get('collection_fee_model') ?? '') ||
      undefined) as SettingsBody['collection_fee_model'],
    payout_fee_pct,
    payout_fee_model: (String(formData.get('payout_fee_model') ?? '') ||
      undefined) as SettingsBody['payout_fee_model'],
    settlement_fee_pct,
    notification_emails: emails(formData.get('notification_emails')),
    enabled_methods: enabled_methods.length > 0 ? enabled_methods : undefined,
  };

  try {
    await patchMerchantSettings(merchantId, body);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'save failed');
    redirect(`/merchants/onboarding/${merchantId}/settings?err=${msg}`);
  }

  revalidatePath(`/merchants/onboarding/${merchantId}/settings`);
  redirect(`/merchants/onboarding/${merchantId}/settings?ok=settings`);
}

export async function createSubMerchantAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  const name = String(formData.get('sub_name') ?? '').trim();
  if (!merchantId) redirect('/compliance');
  if (name.length < 2) {
    redirect(`/merchants/onboarding/${merchantId}/settings?err=missing-name`);
  }

  const code = String(formData.get('sub_code') ?? '').trim() || undefined;
  const pref = String(formData.get('sub_settlement_preference') ?? '').trim() || undefined;
  const bank = String(formData.get('sub_bank_name') ?? '').trim();
  const account = String(formData.get('sub_account_number') ?? '').trim();
  const branch = String(formData.get('sub_branch_code') ?? '').trim();

  const dest =
    bank || account || branch
      ? {
          bank_name: bank || undefined,
          account_number: account || undefined,
          branch_code: branch || undefined,
        }
      : undefined;

  try {
    await createSubMerchantAsAdmin({
      merchant_id: merchantId,
      name,
      code,
      settlement_preference: pref as 'daily' | 'weekly' | 'monthly' | 'on_demand' | undefined,
      settlement_destination: dest,
    });
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'sub create failed');
    redirect(`/merchants/onboarding/${merchantId}/settings?err=${msg}`);
  }

  revalidatePath(`/merchants/onboarding/${merchantId}/settings`);
  redirect(`/merchants/onboarding/${merchantId}/settings?ok=sub-created`);
}

export async function saveSubMerchantSettingsAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  const subId = String(formData.get('sub_id') ?? '');
  if (!merchantId || !subId) redirect('/compliance');

  const collection_fee_pct = num(formData.get('collection_fee_pct'));
  const payout_fee_pct = num(formData.get('payout_fee_pct'));

  const negErr = rejectNegatives([
    { name: 'Collection fee %', value: collection_fee_pct },
    { name: 'Payout fee %', value: payout_fee_pct },
  ]);
  if (negErr) {
    redirect(`/merchants/onboarding/${merchantId}/settings?err=${encodeURIComponent(negErr)}`);
  }

  const enabled_methods = ENABLED_METHOD_OPTIONS.filter(
    (m) => String(formData.get(`method_${m}`) ?? '') === 'on',
  );

  const body: SettingsBody = {
    collection_fee_pct,
    collection_fee_model: (String(formData.get('collection_fee_model') ?? '') ||
      undefined) as SettingsBody['collection_fee_model'],
    payout_fee_pct,
    payout_fee_model: (String(formData.get('payout_fee_model') ?? '') ||
      undefined) as SettingsBody['payout_fee_model'],
    enabled_methods: enabled_methods.length > 0 ? enabled_methods : undefined,
  };

  try {
    await patchSubMerchantSettings(subId, body);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'save failed');
    redirect(`/merchants/onboarding/${merchantId}/settings?err=${msg}`);
  }

  revalidatePath(`/merchants/onboarding/${merchantId}/settings`);
  redirect(`/merchants/onboarding/${merchantId}/settings?ok=sub-settings`);
}
