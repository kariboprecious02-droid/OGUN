/**
 * Payout Orchestrator — Execution Spec §6.5.
 *
 *   1. Resolve fee model from settings, compute total_debit/recipient_amount.
 *   2. Verify payout wallet.available_balance >= total_debit.
 *      Insufficient → fail pre-provider + emit webhook.
 *   3. Persist payout + RESERVE total_debit in the same tx (payout_reserve).
 *   4. Dispatch to Paystack via connector.
 *   5. Terminal-state handler:
 *        - succeeded: reserve -> principal_debit + fee_debit
 *        - failed:    payout_release (full reserved)
 *        - reversed:  payout_reversal_credit + fee reversal (policy)
 */

import { withTransaction } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { OgunError } from '@/infra/errors';
import { logger } from '@/infra/logger';
import { config } from '@/infra/config';
import {
  getMerchant,
  getSubMerchant,
} from '@/modules/merchant/merchant.service';
import { MerchantStatus } from '@/modules/merchant/merchant.types';
import { resolveEffectiveSettings } from '@/modules/merchant/settings.repository';
import { findWalletBySub, lockWalletForUpdate } from '@/modules/wallet/wallet.repository';
import { postLedgerEntry } from '@/modules/wallet/ledger';
import { LedgerTxType } from '@/modules/wallet/wallet.types';
import { computePayoutFee } from '@/modules/collection/fees';
import {
  pickPayoutProvider,
  getPayoutConnector,
} from '@/modules/connectors/registry';
import {
  insertPayout,
  findPayout,
  findPayoutByProviderRef,
  lockPayout,
  updatePayout,
  listPayouts as listPayoutsRepo,
} from './payout.repository';
import { PayoutRow, PayoutStatus, PayoutStatusValue, isPayoutTerminal } from './payout.types';
import {
  findBeneficiary,
  insertBeneficiary,
  BeneficiaryRow,
} from './beneficiary.repository';
import { emitEvent } from '@/modules/webhook/webhook.service';
import { enqueuePollingJob } from '@/modules/polling/polling.service';

export type CreatePayoutInput = {
  merchant_id: string;
  sub_merchant_id: string;
  amount: number;
  currency: string;
  method: 'mobile_money' | 'bank_transfer' | 'demo';
  beneficiary: {
    id?: string;
    name?: string;
    mobile_number?: string;
    bank_code?: string;
    account_number?: string;
  };
  reference?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
};

export type CreatePayoutResult = { payout: PayoutRow };

async function resolveBeneficiary(input: CreatePayoutInput): Promise<BeneficiaryRow> {
  if (input.beneficiary.id) {
    const b = await findBeneficiary(input.beneficiary.id);
    if (!b) throw OgunError.notFound('Beneficiary', input.beneficiary.id);
    return b;
  }
  const beneficiaryType: 'mobile_money' | 'bank_account' =
    input.method === 'bank_transfer' ? 'bank_account' : 'mobile_money';
  return insertBeneficiary({
    id: newId('beneficiary'),
    merchant_id: input.merchant_id,
    sub_merchant_id: input.sub_merchant_id,
    beneficiary_type: beneficiaryType,
    provider: input.method === 'demo' ? 'demo' : 'paystack',
    provider_recipient_type: beneficiaryType === 'mobile_money' ? 'mobile_money' : 'kepss',
    provider_recipient_code: null,
    name: input.beneficiary.name ?? 'Unknown',
    mobile_number: input.beneficiary.mobile_number ?? null,
    bank_code: input.beneficiary.bank_code ?? null,
    account_number: input.beneficiary.account_number ?? null,
    currency: input.currency,
  });
}

export async function createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
  const merchant = await getMerchant(input.merchant_id);
  if (merchant.status !== MerchantStatus.Active) {
    throw OgunError.merchantNotActive(merchant.id);
  }
  const sub = await getSubMerchant(input.sub_merchant_id);
  if (sub.merchant_id !== merchant.id) {
    throw OgunError.invalidRequest('sub_merchant_id does not belong to merchant_id');
  }
  if (sub.status !== 'active') throw OgunError.subMerchantNotActive(sub.id);

  const settings = await resolveEffectiveSettings(merchant.id, sub.id);

  const feeSnapshot = computePayoutFee(
    input.amount,
    settings.payout_fee_pct,
    settings.payout_fee_model,
    input.currency,
  );

  if (feeSnapshot.recipient_amount <= 0) {
    throw OgunError.invalidRequest(
      'recipient_amount must be > 0 after applying fee (fee exceeds amount)',
    );
  }

  const beneficiary = await resolveBeneficiary(input);
  const isSandbox = config.ogunEnv === 'sandbox';
  const provider = pickPayoutProvider(input.method, isSandbox);

  // Verify wallet balance, persist + reserve in the SAME transaction
  const payoutRow = await withTransaction(async (client) => {
    const wallet = await findWalletBySub(sub.id, 'payout', input.currency);
    if (!wallet) throw OgunError.notFound('payout wallet', sub.id);
    const locked = await lockWalletForUpdate(client, wallet.id);

    if (locked.available_balance < feeSnapshot.total_debit) {
      throw OgunError.insufficientPayoutBalance({
        available_balance: locked.available_balance,
        required: feeSnapshot.total_debit,
        wallet_id: wallet.id,
      });
    }

    const row = await insertPayout({
      id: newId('payout'),
      merchant_id: merchant.id,
      sub_merchant_id: sub.id,
      beneficiary_id: beneficiary.id,
      amount: feeSnapshot.amount,
      fee_amount: feeSnapshot.fee_amount,
      total_debit: feeSnapshot.total_debit,
      recipient_amount: feeSnapshot.recipient_amount,
      fee_model: feeSnapshot.model,
      fee_snapshot: feeSnapshot as unknown as Record<string, unknown>,
      currency: input.currency,
      method: input.method,
      provider: provider.provider,
      internal_method: provider.internalMethod,
      external_reference: input.reference ?? null,
      metadata: input.metadata ?? null,
      fee_model_source: settings.source === 'sub_merchant' ? 'sub_merchant_config' : 'merchant_config',
      idempotency_key: input.idempotency_key ?? null,
    });

    await postLedgerEntry(client, {
      merchantId: merchant.id,
      subMerchantId: sub.id,
      walletId: wallet.id,
      walletType: 'payout',
      transactionType: LedgerTxType.PayoutReserve,
      direction: 'debit',
      amount: feeSnapshot.total_debit,
      currency: input.currency,
      referenceType: 'payout',
      referenceId: row.id,
      idempotencyKey: `payout_reserve:${row.id}`,
      description: `Payout reserve ${row.id}`,
    });

    await updatePayout(client, row.id, {
      status: PayoutStatus.Queued,
      wallet_reserved_amount: feeSnapshot.total_debit,
      wallet_reserved_at: new Date(),
    });

    return { ...row, status: PayoutStatus.Queued } as PayoutRow;
  });

  await emitEvent({
    merchantId: merchant.id,
    type: 'payout.created',
    data: {
      payout_id: payoutRow.id,
      merchant_id: merchant.id,
      sub_merchant_id: sub.id,
      amount: payoutRow.amount,
      fee_amount: payoutRow.fee_amount,
      total_debit: payoutRow.total_debit,
      recipient_amount: payoutRow.recipient_amount,
      fee_model: payoutRow.fee_model,
      reference: payoutRow.external_reference,
    },
  });

  void dispatchPayout(payoutRow.id, beneficiary).catch((err) =>
    logger.error({ err, payout_id: payoutRow.id }, 'payout dispatch failed'),
  );

  return { payout: payoutRow };
}

async function dispatchPayout(payoutId: string, beneficiary: BeneficiaryRow): Promise<void> {
  const row = await findPayout(payoutId);
  if (!row) return;
  const connector = getPayoutConnector(row.provider);
  const result = await connector.initiatePayout({
    payout_id: row.id,
    amount: row.recipient_amount,
    currency: row.currency,
    method: row.method,
    internal_method: row.internal_method,
    beneficiary: {
      name: beneficiary.name,
      mobile_number: beneficiary.mobile_number ?? undefined,
      bank_code: beneficiary.bank_code ?? undefined,
      account_number: beneficiary.account_number ?? undefined,
      provider_recipient_code: beneficiary.provider_recipient_code ?? undefined,
    },
    reference: row.external_reference ?? row.id,
    reason: 'Ogun payout',
    metadata: row.metadata ?? undefined,
  });

  await withTransaction(async (client) => {
    const locked = await lockPayout(client, row.id);
    if (isPayoutTerminal(locked.status)) return;

    // Dispatch NEVER writes a terminal status — terminal flows
    // exclusively through resolvePayout so the reserve→finalize /
    // reserve→release ledger logic is the single source of truth.
    // Map the connector's normalized signal to a non-terminal state
    // here; the subsequent resolvePayout call below does the real work.
    const nextStatus: PayoutStatusValue =
      result.normalized_status === 'pending_approval'
        ? PayoutStatus.PendingApproval
        : PayoutStatus.Processing;

    await updatePayout(client, row.id, {
      status: nextStatus,
      provider_reference: result.provider_reference,
      provider_transfer_code:
        (result.raw_payload as { transfer_code?: string }).transfer_code ?? null,
      provider_status: (result.raw_payload as { status?: string }).status ?? null,
      failure_reason: result.error_code ?? null,
    });
  });

  if (result.next_action === 'poll') {
    await enqueuePollingJob({
      referenceType: 'payout',
      referenceId: row.id,
      providerReference: result.provider_reference,
      provider: row.provider,
    });
  }

  if (result.normalized_status === 'succeeded') {
    await resolvePayout(row.id, {
      source: 'api',
      normalizedStatus: 'succeeded',
      providerReference: result.provider_reference,
    });
  } else if (result.normalized_status === 'failed') {
    await resolvePayout(row.id, {
      source: 'api',
      normalizedStatus: 'failed',
      providerReference: result.provider_reference,
      failureReason: result.error_code ?? 'provider_rejected',
    });
  }
}

export async function resolvePayout(
  payoutId: string,
  input: {
    source: 'webhook' | 'poller' | 'api' | 'admin';
    normalizedStatus: 'succeeded' | 'failed' | 'reversed';
    providerReference?: string;
    failureReason?: string;
    reversalReason?: string;
  },
): Promise<PayoutRow> {
  const updated = await withTransaction(async (client) => {
    const row = await lockPayout(client, payoutId);
    const wallet = await findWalletBySub(row.sub_merchant_id, 'payout', row.currency);
    if (!wallet) throw new Error(`No payout wallet for ${row.sub_merchant_id}`);
    await lockWalletForUpdate(client, wallet.id);

    // Reversal path — only after a prior success
    if (input.normalizedStatus === 'reversed') {
      if (row.status !== PayoutStatus.Succeeded) return row;
      await postLedgerEntry(client, {
        merchantId: row.merchant_id,
        subMerchantId: row.sub_merchant_id,
        walletId: wallet.id,
        walletType: 'payout',
        transactionType: LedgerTxType.PayoutReversalCredit,
        direction: 'credit',
        amount: row.recipient_amount,
        currency: row.currency,
        referenceType: 'payout',
        referenceId: row.id,
        idempotencyKey: `payout_reversal_credit:${row.id}`,
        description: `Payout reversal ${row.id}`,
      });
      // Fee reversal policy: §6.3 — default to ops review. We do NOT auto-
      // reverse the fee debit in MVP. Ops can post manual_adjustment entries.
      await updatePayout(client, row.id, {
        status: PayoutStatus.Reversed,
        reversal_indicator: true,
        reversal_reason: input.reversalReason ?? 'provider_reversed',
        final_resolved_at: new Date(),
      });
      return { ...row, status: PayoutStatus.Reversed } as PayoutRow;
    }

    if (isPayoutTerminal(row.status)) return row;

    if (input.normalizedStatus === 'succeeded') {
      // Finalize: reserve -> principal_debit + fee_debit
      await postLedgerEntry(client, {
        merchantId: row.merchant_id,
        subMerchantId: row.sub_merchant_id,
        walletId: wallet.id,
        walletType: 'payout',
        transactionType: LedgerTxType.PayoutPrincipalDebit,
        direction: 'debit',
        amount: row.recipient_amount,
        currency: row.currency,
        referenceType: 'payout',
        referenceId: row.id,
        idempotencyKey: `payout_principal_debit:${row.id}`,
        description: `Payout principal ${row.id}`,
      });
      if (row.fee_amount > 0) {
        await postLedgerEntry(client, {
          merchantId: row.merchant_id,
          subMerchantId: row.sub_merchant_id,
          walletId: wallet.id,
          walletType: 'payout',
          transactionType: LedgerTxType.PayoutFeeDebit,
          direction: 'debit',
          amount: row.fee_amount,
          currency: row.currency,
          referenceType: 'payout',
          referenceId: row.id,
          idempotencyKey: `payout_fee_debit:${row.id}`,
          description: `Payout fee ${row.id}`,
        });
      }
      await updatePayout(client, row.id, {
        status: PayoutStatus.Succeeded,
        provider_reference: input.providerReference ?? row.provider_reference,
        final_resolved_at: new Date(),
      });
      return { ...row, status: PayoutStatus.Succeeded } as PayoutRow;
    }

    // failed — release full reservation
    await postLedgerEntry(client, {
      merchantId: row.merchant_id,
      subMerchantId: row.sub_merchant_id,
      walletId: wallet.id,
      walletType: 'payout',
      transactionType: LedgerTxType.PayoutRelease,
      direction: 'credit',
      amount: row.total_debit,
      currency: row.currency,
      referenceType: 'payout',
      referenceId: row.id,
      idempotencyKey: `payout_release:${row.id}`,
      description: `Payout release ${row.id}`,
    });
    await updatePayout(client, row.id, {
      status: PayoutStatus.Failed,
      failure_reason: input.failureReason ?? 'unknown',
      final_resolved_at: new Date(),
    });
    return { ...row, status: PayoutStatus.Failed } as PayoutRow;
  });

  if (updated.status === PayoutStatus.Succeeded) {
    await emitEvent({
      merchantId: updated.merchant_id,
      type: 'payout.succeeded',
      data: {
        payout_id: updated.id,
        merchant_id: updated.merchant_id,
        sub_merchant_id: updated.sub_merchant_id,
        amount: updated.amount,
        recipient_amount: updated.recipient_amount,
        fee_model: updated.fee_model,
        provider_reference: updated.provider_reference,
      },
    });
  } else if (updated.status === PayoutStatus.Failed) {
    await emitEvent({
      merchantId: updated.merchant_id,
      type: 'payout.failed',
      data: {
        payout_id: updated.id,
        merchant_id: updated.merchant_id,
        amount: updated.amount,
        failure_reason: updated.failure_reason ?? 'unknown',
      },
    });
  } else if (updated.status === PayoutStatus.Reversed) {
    await emitEvent({
      merchantId: updated.merchant_id,
      type: 'payout.reversed',
      data: {
        payout_id: updated.id,
        merchant_id: updated.merchant_id,
        amount: updated.amount,
        reversal_reason: updated.reversal_reason,
      },
    });
  }

  return updated;
}

export async function getPayout(id: string): Promise<PayoutRow> {
  const row = await findPayout(id);
  if (!row) throw OgunError.notFound('Payout', id);
  return row;
}

export async function listPayouts(params: Parameters<typeof listPayoutsRepo>[0]) {
  return listPayoutsRepo(params);
}

export { findPayoutByProviderRef };
