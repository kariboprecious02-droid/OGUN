/**
 * Beneficiary service — Execution Spec §3.8 + §12.4 (routes).
 *
 * Beneficiaries belong to a sub-merchant. They can be mobile money
 * (M-Pesa / Airtel via Paystack) or bank accounts (KEPSS via Paystack).
 *
 * When a beneficiary is created with real account details, we optionally
 * try to resolve a Paystack `transfer_recipient` so future payouts don't
 * have to round-trip. In sandbox and for `demo` provider we skip the
 * Paystack call and leave the recipient code null (the Demo connector
 * doesn't need one).
 */

import { newId } from '@/infra/ids';
import { OgunError } from '@/infra/errors';
import { logger } from '@/infra/logger';
import { config } from '@/infra/config';
import {
  getMerchant,
  getSubMerchant,
} from '@/modules/merchant/merchant.service';
import { MerchantStatus } from '@/modules/merchant/merchant.types';
import {
  BeneficiaryRow,
  insertBeneficiary,
  findBeneficiary,
  listBeneficiaries as listBeneficiariesRepo,
  updateBeneficiary as updateBeneficiaryRepo,
  deleteBeneficiary as deleteBeneficiaryRepo,
} from './beneficiary.repository';
import { PaystackPayoutConnector } from '@/modules/connectors/paystack.payout.connector';

export type CreateBeneficiaryInput = {
  merchant_id: string;
  sub_merchant_id: string;
  name: string;
  beneficiary_type: 'mobile_money' | 'bank_account';
  mobile_number?: string;
  bank_code?: string;
  account_number?: string;
  currency?: string;
  provider?: 'paystack' | 'demo';
};

export async function createBeneficiary(
  input: CreateBeneficiaryInput,
): Promise<BeneficiaryRow> {
  const merchant = await getMerchant(input.merchant_id);
  if (merchant.status !== MerchantStatus.Active) {
    throw OgunError.merchantNotActive(merchant.id);
  }
  const sub = await getSubMerchant(input.sub_merchant_id);
  if (sub.merchant_id !== merchant.id) {
    throw OgunError.invalidRequest('sub_merchant_id does not belong to merchant_id');
  }
  if (sub.status !== 'active') throw OgunError.subMerchantNotActive(sub.id);

  // Shape validation
  if (input.beneficiary_type === 'mobile_money' && !input.mobile_number) {
    throw OgunError.invalidRequest('mobile_money beneficiary requires mobile_number');
  }
  if (input.beneficiary_type === 'bank_account') {
    if (!input.bank_code || !input.account_number) {
      throw OgunError.invalidRequest('bank_account beneficiary requires bank_code and account_number');
    }
  }

  const provider = input.provider ?? (config.ogunEnv === 'sandbox' ? 'demo' : 'paystack');
  const currency = input.currency ?? 'KES';

  let providerRecipientCode: string | null = null;
  const providerRecipientType =
    input.beneficiary_type === 'mobile_money' ? 'mobile_money' : 'kepss';
  let verificationStatus: 'pending' | 'verified' | 'failed' = 'pending';

  // Best-effort Paystack recipient creation.  If we're in sandbox or
  // the caller selected `demo` we skip this entirely.
  if (provider === 'paystack' && config.paystack.secretKey) {
    try {
      const connector = new PaystackPayoutConnector();
      providerRecipientCode = await connector.resolveRecipient({
        type: providerRecipientType as 'mobile_money' | 'kepss',
        name: input.name,
        account_number:
          input.beneficiary_type === 'mobile_money'
            ? (input.mobile_number as string)
            : (input.account_number as string),
        bank_code: input.bank_code,
        currency,
      });
      verificationStatus = 'verified';
    } catch (err) {
      logger.warn(
        { err, beneficiary_name: input.name },
        'paystack recipient resolution failed; beneficiary saved unverified',
      );
      verificationStatus = 'failed';
    }
  }

  return insertBeneficiary({
    id: newId('beneficiary'),
    merchant_id: merchant.id,
    sub_merchant_id: sub.id,
    beneficiary_type: input.beneficiary_type,
    provider,
    provider_recipient_type: providerRecipientType,
    provider_recipient_code: providerRecipientCode,
    name: input.name,
    mobile_number: input.mobile_number ?? null,
    bank_code: input.bank_code ?? null,
    account_number: input.account_number ?? null,
    currency,
    verification_status: verificationStatus,
  });
}

export async function getBeneficiary(
  merchantId: string,
  id: string,
): Promise<BeneficiaryRow> {
  const b = await findBeneficiary(id);
  if (!b || b.merchant_id !== merchantId) {
    throw OgunError.notFound('Beneficiary', id);
  }
  return b;
}

export async function listBeneficiaries(params: {
  merchant_id: string;
  sub_merchant_id?: string;
  page: number;
  limit: number;
}) {
  return listBeneficiariesRepo(params);
}

export async function updateBeneficiary(
  merchantId: string,
  id: string,
  patch: Parameters<typeof updateBeneficiaryRepo>[1],
): Promise<BeneficiaryRow> {
  await getBeneficiary(merchantId, id); // ownership guard
  const updated = await updateBeneficiaryRepo(id, patch);
  if (!updated) throw OgunError.notFound('Beneficiary', id);
  return updated;
}

export async function deleteBeneficiary(
  merchantId: string,
  id: string,
): Promise<void> {
  await getBeneficiary(merchantId, id); // ownership guard
  const removed = await deleteBeneficiaryRepo(id);
  if (!removed) throw OgunError.notFound('Beneficiary', id);
}
