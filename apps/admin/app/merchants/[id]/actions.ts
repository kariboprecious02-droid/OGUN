'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  patchMerchantSettings,
  patchSubMerchantSettings,
  createSubMerchantAsAdmin,
  suspendMerchant,
  rotateMerchantSecretKey,
  rotateMerchantWebhookSecret,
  sendTestWebhook,
  type RotationEnv,
  type SettingsBody,
} from '@/lib/api';

const ENABLED_COLLECTION_METHODS = ['mpesa', 'airtel', 'till', 'card', 'bank'];
const ENABLED_PAYOUT_METHODS = ['mpesa', 'airtel', 'bank'];

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

export async function panelSaveMerchantSettingsAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');

  const collection_fee_pct = num(formData.get('collection_fee_pct'));
  const payout_fee_pct = num(formData.get('payout_fee_pct'));
  const settlement_fee_pct = num(formData.get('settlement_fee_pct'));

  const negErr = rejectNegatives([
    { name: 'Collection fee percentage', value: collection_fee_pct },
    { name: 'Payout fee percentage', value: payout_fee_pct },
    { name: 'Settlement fee percentage', value: settlement_fee_pct },
  ]);
  if (negErr) {
    redirect(`/merchants/${merchantId}?tab=accounts&err=${encodeURIComponent(negErr)}`);
  }

  const enabled_methods = ENABLED_COLLECTION_METHODS.filter(
    (m) => String(formData.get(`method_${m}`) ?? '') === 'on',
  );
  const enabled_payout_methods = ENABLED_PAYOUT_METHODS.filter(
    (m) => String(formData.get(`payout_method_${m}`) ?? '') === 'on',
  );
  const settlementFreq = String(formData.get('settlement_frequency') ?? '').trim() || undefined;
  const webhookUrl = String(formData.get('webhook_url') ?? '').trim() || null;

  if (webhookUrl && !webhookUrl.startsWith('https://')) {
    redirect(`/merchants/${merchantId}?tab=accounts&err=${encodeURIComponent('Webhook URL must use HTTPS.')}`);
  }

  const body: SettingsBody = {
    collection_fee_pct,
    collection_fee_model: (String(formData.get('collection_fee_model') ?? '') ||
      undefined) as SettingsBody['collection_fee_model'],
    payout_fee_pct,
    payout_fee_model: (String(formData.get('payout_fee_model') ?? '') ||
      undefined) as SettingsBody['payout_fee_model'],
    settlement_fee_pct,
    notification_emails: emails(formData.get('notification_emails')),
    enabled_methods: enabled_methods.length > 0 ? enabled_methods : [],
    enabled_payout_methods: enabled_payout_methods.length > 0 ? enabled_payout_methods : [],
    settlement_frequency: settlementFreq as SettingsBody['settlement_frequency'],
    webhook_url: webhookUrl,
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

  const collection_fee_pct = num(formData.get('collection_fee_pct'));
  const payout_fee_pct = num(formData.get('payout_fee_pct'));

  const negErr = rejectNegatives([
    { name: 'Collection fee percentage', value: collection_fee_pct },
    { name: 'Payout fee percentage', value: payout_fee_pct },
  ]);
  if (negErr) {
    redirect(`/merchants/${merchantId}?tab=sub_merchants&err=${encodeURIComponent(negErr)}`);
  }

  const enabled_methods = ENABLED_COLLECTION_METHODS.filter(
    (m: string) => String(formData.get(`method_${m}`) ?? '') === 'on',
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

const ROTATION_FLASH_TTL_S = 600;

function rotationEnv(v: FormDataEntryValue | null): RotationEnv {
  return String(v ?? 'sandbox') === 'live' ? 'live' : 'sandbox';
}

async function setRotationFlash(
  merchantId: string,
  payload: { kind: 'secret' | 'webhook_secret'; environment: RotationEnv; value: string },
): Promise<void> {
  const jar = await cookies();
  jar.set(`rotated_${merchantId}`, JSON.stringify(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/merchants/${merchantId}`,
    maxAge: ROTATION_FLASH_TTL_S,
  });
}

export async function panelRotateSecretKeyAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');
  const env = rotationEnv(formData.get('environment'));
  try {
    const result = await rotateMerchantSecretKey(merchantId, env);
    await setRotationFlash(merchantId, {
      kind: 'secret',
      environment: env,
      value: result.secret_key,
    });
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'rotate failed');
    redirect(`/merchants/${merchantId}?tab=credentials&err=${msg}`);
  }
  revalidatePath(`/merchants/${merchantId}`);
  redirect(`/merchants/${merchantId}?tab=credentials&ok=secret-rotated`);
}

export async function panelRotateWebhookSecretAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');
  const env = rotationEnv(formData.get('environment'));
  try {
    const result = await rotateMerchantWebhookSecret(merchantId, env);
    await setRotationFlash(merchantId, {
      kind: 'webhook_secret',
      environment: env,
      value: result.webhook_secret,
    });
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'rotate failed');
    redirect(`/merchants/${merchantId}?tab=credentials&err=${msg}`);
  }
  revalidatePath(`/merchants/${merchantId}`);
  redirect(`/merchants/${merchantId}?tab=credentials&ok=webhook-rotated`);
}

export async function panelDismissRotationFlashAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');
  const jar = await cookies();
  jar.delete(`rotated_${merchantId}`);
  redirect(`/merchants/${merchantId}?tab=credentials`);
}

export async function panelSendTestWebhookAction(formData: FormData): Promise<void> {
  const merchantId = String(formData.get('merchant_id') ?? '');
  if (!merchantId) redirect('/compliance');
  try {
    const result = await sendTestWebhook(merchantId);
    if (result.ok) {
      redirect(
        `/merchants/${merchantId}?tab=accounts&ok=webhook-test-${result.status}`,
      );
    } else {
      redirect(
        `/merchants/${merchantId}?tab=accounts&err=${encodeURIComponent(`Webhook test failed: HTTP ${result.status} — ${result.body_excerpt.slice(0, 200)}`)}`,
      );
    }
  } catch (err) {
    const msg = encodeURIComponent(err instanceof Error ? err.message : 'webhook test failed');
    redirect(`/merchants/${merchantId}?tab=accounts&err=${msg}`);
  }
}
