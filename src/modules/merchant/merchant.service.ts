import { newId } from '@/infra/ids';
import { OgunError } from '@/infra/errors';
import { logger } from '@/infra/logger';
import {
  insertMerchant,
  findMerchant,
  updateMerchantStatus,
  insertSubMerchant,
  findSubMerchant,
  listSubMerchantsByMerchant,
  activateSubMerchant,
  withMerchantTx,
  patchMerchant,
  patchSubMerchant,
} from './merchant.repository';
import {
  MerchantRow,
  SubMerchantRow,
  MerchantStatusValue,
  MerchantStatus,
  canTransition,
} from './merchant.types';
import { issueCredentials, IssuedCredentialSet } from '@/modules/auth/auth.service';
import { createWalletsForSubMerchant } from '@/modules/wallet/wallet.service';

export type CreateMerchantInput = {
  legal_name: string;
  trading_name: string;
  registration_number?: string;
  tax_id?: string;
  country?: string;
  settlement_currency?: string;
  business_category?: string;
  business_address?: Record<string, unknown>;
  website_url?: string;
  expected_monthly_volume?: number;
  expected_avg_ticket?: number;
  contact?: { name?: string; email?: string; phone?: string };
  notification_emails?: string[];
};

export async function createMerchant(input: CreateMerchantInput): Promise<MerchantRow> {
  const merchant = await insertMerchant({
    id: newId('merchant'),
    legal_name: input.legal_name,
    trading_name: input.trading_name,
    registration_number: input.registration_number ?? null,
    tax_id: input.tax_id ?? null,
    country: input.country ?? 'KE',
    settlement_currency: input.settlement_currency ?? 'KES',
    business_category: input.business_category ?? null,
    business_address: input.business_address ?? null,
    website_url: input.website_url ?? null,
    expected_monthly_volume: input.expected_monthly_volume ?? null,
    expected_avg_ticket: input.expected_avg_ticket ?? null,
    contact_name: input.contact?.name ?? null,
    contact_email: input.contact?.email ?? null,
    contact_phone: input.contact?.phone ?? null,
  });
  logger.info({ merchant_id: merchant.id }, 'merchant created');
  return merchant;
}

export async function getMerchant(id: string): Promise<MerchantRow> {
  const m = await findMerchant(id);
  if (!m) throw OgunError.notFound('Merchant', id);
  return m;
}

export async function transitionMerchant(
  id: string,
  next: MerchantStatusValue,
): Promise<MerchantRow> {
  const merchant = await getMerchant(id);
  if (!canTransition(merchant.status, next)) {
    throw OgunError.invalidRequest(
      `Cannot transition merchant from ${merchant.status} to ${next}`,
    );
  }
  await updateMerchantStatus(null, id, next);
  const updated = await findMerchant(id);
  return updated!;
}

export type CreateSubMerchantInput = {
  merchant_id: string;
  name: string;
  code?: string;
  settlement_preference?: 'daily' | 'weekly' | 'monthly' | 'on_demand';
  settlement_destination?: Record<string, unknown>;
  contact?: { name?: string; email?: string; phone?: string };
};

export async function createSubMerchant(input: CreateSubMerchantInput): Promise<SubMerchantRow> {
  const parent = await getMerchant(input.merchant_id);
  if (parent.status === MerchantStatus.Rejected || parent.status === MerchantStatus.Suspended) {
    throw OgunError.merchantNotActive(parent.id);
  }
  return insertSubMerchant({
    id: newId('subMerchant'),
    merchant_id: input.merchant_id,
    name: input.name,
    code: input.code ?? null,
    settlement_preference: input.settlement_preference ?? null,
    settlement_destination: input.settlement_destination ?? null,
    contact_name: input.contact?.name ?? null,
    contact_email: input.contact?.email ?? null,
    contact_phone: input.contact?.phone ?? null,
  });
}

export async function getSubMerchant(id: string): Promise<SubMerchantRow> {
  const s = await findSubMerchant(id);
  if (!s) throw OgunError.notFound('SubMerchant', id);
  return s;
}

export async function listSubMerchants(merchantId: string): Promise<SubMerchantRow[]> {
  await getMerchant(merchantId);
  return listSubMerchantsByMerchant(merchantId);
}

/**
 * Goes merchant live: issues credentials (both environments), activates all
 * sub-merchants, creates their collection + payout wallets. §4.1 last step.
 */
export async function activateMerchant(merchantId: string): Promise<{
  merchant: MerchantRow;
  credentials: IssuedCredentialSet;
  subMerchants: SubMerchantRow[];
}> {
  const merchant = await getMerchant(merchantId);
  if (merchant.status !== MerchantStatus.Approved && merchant.status !== MerchantStatus.CredentialsIssued) {
    throw OgunError.invalidRequest(
      `Merchant must be approved or credentials_issued before activation (current: ${merchant.status})`,
    );
  }

  const credentials = await issueCredentials(merchantId);

  const subMerchants = await withMerchantTx(async (client) => {
    await updateMerchantStatus(client, merchantId, MerchantStatus.CredentialsIssued);
    await updateMerchantStatus(client, merchantId, MerchantStatus.Active);
    const subs = await listSubMerchantsByMerchant(merchantId);
    for (const sub of subs) {
      await activateSubMerchant(client, sub.id);
      await createWalletsForSubMerchant(client, merchantId, sub.id);
    }
    return subs;
  });

  const updated = await getMerchant(merchantId);
  logger.info({ merchant_id: merchantId, sub_count: subMerchants.length }, 'merchant activated');
  return { merchant: updated, credentials, subMerchants };
}

export async function suspendMerchant(merchantId: string, reason: string): Promise<MerchantRow> {
  const m = await transitionMerchant(merchantId, MerchantStatus.Suspended);
  logger.info({ merchant_id: merchantId, reason }, 'merchant suspended');
  return m;
}

/**
 * Partial update of a merchant profile. Only whitelisted columns are
 * writable; status and settlement_currency cannot change after create.
 * The underlying repository filters the column list for safety.
 */
export async function updateMerchantProfile(
  merchantId: string,
  patch: Record<string, unknown>,
): Promise<MerchantRow> {
  await getMerchant(merchantId);
  const updated = await patchMerchant(merchantId, patch);
  if (!updated) throw OgunError.notFound('Merchant', merchantId);
  return updated;
}

export async function updateSubMerchantProfile(
  subMerchantId: string,
  patch: Record<string, unknown>,
): Promise<SubMerchantRow> {
  await getSubMerchant(subMerchantId);
  const updated = await patchSubMerchant(subMerchantId, patch);
  if (!updated) throw OgunError.notFound('SubMerchant', subMerchantId);
  return updated;
}
