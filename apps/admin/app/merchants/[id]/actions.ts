'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  patchMerchantSettings,
  patchSubMerchantSettings,
  createSubMerchantAsAdmin,
  suspendMerchant,
  type SettingsBody,
} from '@/lib/api';

const ENABLED_METHOD_OPTIONS = ['mpesa', 'airtel', 'till', 'card', 'bank'];

function num(v: FormDataEntryValue | null): number | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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

export async function panelSaveMerchantSettingsAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');

  const enabled_methods = ENABLED_METHOD_OPTIONS.filter(
    (m) => String(formData.get(`method_${m}`) ?? '') === 'on',
  );
  const body: SettingsBody = {
    collection_fee_pct: num(formData.get('collection_fee_pct')),
    collection_fee_model: (String(formData.get('collection_fee_model') ?? '') ||
      undefined) as SettingsBody['collection_fee_model'],
    payout_fee_pct: num(formData.get('payout_fee_pct')),
    payout_fee_model: (String(formData.get('payout_fee_model') ?? '') ||
      undefined) as SettingsBody['payout_fee_model'],
    settlement_fee_pct: num(formData.get('settlement_fee_pct')),
    notification_emails: emails(formData.get('notification_emails')),
    enabled_methods: enabled_methods.length > 0 ? enabled_methods : undefined,
  };

  try {
    await patchMerchantSettings(merchantId, body);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'save failed');
    redirect(`/merchants/${merchantId}?tab=accounts&err=${msg}`);
  }
  revalidatePath(`/merchants/${merchantId}`);
  redirect(`/merchants/${merchantId}?tab=accounts&ok=settings`);
}

export async function panelSaveSubMerchantSettingsAction(
  formData: FormData,
): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  const subId = String(formData.get('sub_id') ?? '');
  if (!merchantId || !subId) redirect('/compliance');

  const enabled_methods = ENABLED_METHOD_OPTIONS.filter(
    (m) => String(formData.get(`method_${m}`) ?? '') === 'on',
  );
  const body: SettingsBody = {
    collection_fee_pct: num(formData.get('collection_fee_pct')),
    collection_fee_model: (String(formData.get('collection_fee_model') ?? '') ||
      undefined) as SettingsBody['collection_fee_model'],
    payout_fee_pct: num(formData.get('payout_fee_pct')),
    payout_fee_model: (String(formData.get('payout_fee_model') ?? '') ||
      undefined) as SettingsBody['payout_fee_model'],
    enabled_methods: enabled_methods.length > 0 ? enabled_methods : undefined,
  };

  try {
    await patchSubMerchantSettings(subId, body);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'save failed');
    redirect(`/merchants/${merchantId}?tab=sub_merchants&err=${msg}`);
  }
  revalidatePath(`/merchants/${merchantId}`);
  redirect(`/merchants/${merchantId}?tab=sub_merchants&ok=sub-settings`);
}

export async function panelCreateSubMerchantAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  const name = String(formData.get('sub_name') ?? '').trim();
  if (!merchantId) redirect('/compliance');
  if (name.length < 2) {
    redirect(`/merchants/${merchantId}?tab=sub_merchants&err=missing-name`);
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
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'create failed');
    redirect(`/merchants/${merchantId}?tab=sub_merchants&err=${msg}`);
  }
  revalidatePath(`/merchants/${merchantId}`);
  redirect(`/merchants/${merchantId}?tab=sub_merchants&ok=sub-created`);
}

export async function panelSuspendMerchantAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!merchantId) redirect('/compliance');
  if (!reason) {
    redirect(`/merchants/${merchantId}?tab=profile&err=missing-reason`);
  }
  try {
    await suspendMerchant(merchantId, reason);
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'suspend failed');
    redirect(`/merchants/${merchantId}?tab=profile&err=${msg}`);
  }
  revalidatePath(`/merchants/${merchantId}`);
  redirect(`/merchants/${merchantId}?tab=profile&ok=suspended`);
}
