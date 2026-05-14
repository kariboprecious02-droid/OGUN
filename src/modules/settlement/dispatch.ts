/**
 * Settlement → payout dispatch — §7.3.
 *
 * After a settlement has been ledgered (`executeSettlement` → 'paid'),
 * we need to actually move the money to the sub-merchant's configured
 * settlement destination. We do that by creating a real payout through
 * the Payout Orchestrator so all the reservation, ledger, and provider
 * plumbing stays the single source of truth.
 *
 * The destination comes from `sub_merchants.settlement_destination`
 * (JSONB with { bank_name, account_number, branch_code/bank_code }).
 * If no destination is configured we log + skip; ops can retry later.
 *
 * The payout is funded from the sub-merchant's *payout* wallet, so
 * the settlement → payout rail requires the payout wallet to already
 * hold enough balance (usually via an internal top-up move from the
 * collection wallet's freshly debited funds).  We handle that with a
 * paired ledger transfer in this file so the behavior is testable
 * end-to-end in sandbox without needing real bank credentials.
 */

import type { PoolClient } from 'pg';
import { query, withTransaction } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { logger } from '@/infra/logger';
import { findWalletBySub, lockWalletForUpdate } from '@/modules/wallet/wallet.repository';
import { postLedgerEntry } from '@/modules/wallet/ledger';
import { LedgerTxType } from '@/modules/wallet/wallet.types';
import { insertBeneficiary } from '@/modules/payout/beneficiary.repository';
import { createPayout } from '@/modules/payout/payout.service';
import { resolveEffectiveSettings } from '@/modules/merchant/settings.repository';
import { resolvePaystackBankCode } from '@/modules/connectors/paystackBanks';

type SubMerchantDestination = {
  bank_name?: string;
  account_number?: string;
  branch_code?: string;
  bank_code?: string;
  beneficiary_name?: string;
  mobile_number?: string;
  type?: 'bank' | 'mobile_money';
};

export async function dispatchSettlementPayout(settlementId: string): Promise<void> {
  const { rows } = await query<{
    id: string;
    merchant_id: string;
    sub_merchant_id: string;
    net_amount: string;
    status: string;
    payout_id: string | null;
    destination_summary: SubMerchantDestination | null;
    settlement_destination: SubMerchantDestination | null;
    sub_merchant_name: string;
    settlement_bank_name: string | null;
    settlement_account_number: string | null;
    settlement_branch_code: string | null;
    settlement_account_holder: string | null;
  }>(
    `SELECT s.id, s.merchant_id, s.sub_merchant_id, s.net_amount, s.status,
            s.payout_id, s.destination_summary,
            sm.settlement_destination, sm.name AS sub_merchant_name,
            ms.settlement_bank_name, ms.settlement_account_number,
            ms.settlement_branch_code, ms.settlement_account_holder
       FROM settlements s
       JOIN sub_merchants sm ON sm.id = s.sub_merchant_id
       LEFT JOIN merchant_settings ms ON ms.merchant_id = s.merchant_id AND ms.sub_merchant_id IS NULL
      WHERE s.id = $1
      LIMIT 1`,
    [settlementId],
  );
  const settlement = rows[0];
  if (!settlement) {
    logger.warn({ settlementId }, 'dispatchSettlementPayout: settlement not found');
    return;
  }

  logger.info({
    settlementId,
    sub_merchant_id: settlement.sub_merchant_id,
    net_amount: settlement.net_amount,
    destination_summary: settlement.destination_summary,
    settlement_destination: settlement.settlement_destination,
    settlement_bank_name: settlement.settlement_bank_name,
    payout_id: settlement.payout_id,
  }, 'dispatchSettlementPayout: entering with destination state');

  if (settlement.payout_id) {
    logger.debug({ settlementId }, 'settlement payout already dispatched; skipping');
    return;
  }

  let destination =
    settlement.destination_summary ?? settlement.settlement_destination ?? null;
  if (!destination && settlement.settlement_bank_name) {
    destination = {
      bank_name: settlement.settlement_bank_name,
      account_number: settlement.settlement_account_number,
      branch_code: settlement.settlement_branch_code,
      beneficiary_name: settlement.settlement_account_holder,
    } as SubMerchantDestination;
  }
  if (!destination) {
    logger.warn(
      { settlementId },
      'no settlement destination on sub_merchant or merchant_settings; payout rail skipped',
    );
    return;
  }

  const netAmount = Number(settlement.net_amount);
  if (netAmount <= 0) return;

  // Compute the fee the Payout Orchestrator will apply so the rail can
  // pre-fund the payout wallet with exactly the amount createPayout()
  // will try to reserve (principal + fee in merchant_covers mode).
  // Settlement payouts should be fee-neutral from the merchant's
  // perspective — the settlement_fee on the Settlement row already
  // represents our commercial take — so we credit the payout wallet
  // with total_debit, not just net.
  let settings;
  try {
    settings = await resolveEffectiveSettings(
      settlement.merchant_id,
      settlement.sub_merchant_id,
    );
  } catch (err) {
    logger.error({ err, settlementId }, 'dispatchSettlementPayout: resolveEffectiveSettings threw');
    throw err;
  }
  const railFee = Math.round((netAmount * settings.payout_fee_pct) / 100);
  const totalDebit =
    settings.payout_fee_model === 'merchant_covers' ? netAmount + railFee : netAmount;

  logger.info({ settlementId, railFee, totalDebit, isBank: !!(destination.account_number && (destination.bank_code ?? (destination.bank_name ? resolvePaystackBankCode(destination.bank_name) : null))) },
    'dispatchSettlementPayout: pre-beneficiary state');

  await withTransaction(async (client) => {
    const payoutWallet = await findWalletBySub(settlement.sub_merchant_id, 'payout');
    if (!payoutWallet) {
      logger.warn(
        { settlementId },
        'payout wallet missing for sub-merchant; cannot dispatch settlement payout',
      );
      return;
    }
    await lockWalletForUpdate(client, payoutWallet.id);
    await postLedgerEntry(client, {
      merchantId: settlement.merchant_id,
      subMerchantId: settlement.sub_merchant_id,
      walletId: payoutWallet.id,
      walletType: 'payout',
      transactionType: LedgerTxType.PayoutWalletTopupCredit,
      direction: 'credit',
      amount: totalDebit,
      currency: payoutWallet.currency,
      referenceType: 'settlement',
      referenceId: settlementId,
      idempotencyKey: `settlement_rail_topup:${settlementId}`,
      description: `Settlement ${settlementId} transferred to payout wallet (incl. rail fee ${railFee})`,
    });
  });

  // Persist a beneficiary row for the destination and then create a
  // payout. The beneficiary is reused across retries by its per-settlement
  // idempotency key.
  const resolvedBankCode = destination.bank_code
    ?? (destination.bank_name ? resolvePaystackBankCode(destination.bank_name) : null)
    ?? null;
  const isBank = !!(destination.account_number && resolvedBankCode);
  if (destination.account_number && !resolvedBankCode && !destination.mobile_number) {
    logger.warn({ settlementId, bank_name: destination.bank_name, branch_code: destination.branch_code },
      'could not resolve Paystack bank code from destination — set a valid bank name or code');
  }
  const beneficiary = await insertBeneficiary({
    id: newId('beneficiary'),
    merchant_id: settlement.merchant_id,
    sub_merchant_id: settlement.sub_merchant_id,
    beneficiary_type: isBank ? 'bank_account' : 'mobile_money',
    provider: isBank ? 'paystack' : (destination.mobile_number ? 'paystack' : 'demo'),
    provider_recipient_type: isBank ? 'nuban' : 'mobile_money',
    provider_recipient_code: null,
    name:
      destination.beneficiary_name ??
      settlement.sub_merchant_name ??
      `Settlement recipient ${settlement.sub_merchant_id}`,
    mobile_number: destination.mobile_number ?? null,
    bank_code: resolvedBankCode,
    account_number: destination.account_number ?? null,
    currency: 'KES',
    verification_status: 'verified',
  });

  const payoutResult = await createPayout({
    merchant_id: settlement.merchant_id,
    sub_merchant_id: settlement.sub_merchant_id,
    amount: netAmount,
    currency: 'KES',
    method: isBank ? 'bank_transfer' : (destination.mobile_number ? 'mobile_money' : 'demo'),
    beneficiary: { id: beneficiary.id },
    reference: `settlement:${settlementId}`,
    reason: 'Ogun settlement payout',
    metadata: { settlement_id: settlementId },
    idempotency_key: `settlement_payout:${settlementId}`,
  });

  await query(
    `UPDATE settlements
        SET payout_id = $2, destination_summary = $3, updated_at = now()
      WHERE id = $1`,
    [
      settlementId,
      payoutResult.payout.id,
      JSON.stringify({
        type: isBank ? 'bank' : 'mobile_money',
        name: beneficiary.name,
        bank_code: beneficiary.bank_code,
        account_number: beneficiary.account_number,
        mobile_number: beneficiary.mobile_number,
      }),
    ],
  );

  logger.info(
    { settlementId, payoutId: payoutResult.payout.id },
    'settlement payout rail dispatched',
  );
}

// Re-export the PoolClient type so the settlement service can type-narrow
// without importing pg directly.
export type { PoolClient };
