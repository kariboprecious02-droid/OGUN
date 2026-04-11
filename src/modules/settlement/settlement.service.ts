/**
 * Settlement module — Execution Spec §7.
 *
 *   - Eligibility is per sub-merchant (§7.1). No cross-sub-merchant aggregation.
 *   - Only business_status='successful' AND settlement_eligible=true collections settle.
 *   - Refund adjustments apply to NEXT settlement cycle as negative offsets.
 *   - Collection wallet must have sufficient available_balance BEFORE execution.
 */

import { query, withTransaction } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { OgunError } from '@/infra/errors';
import { logger } from '@/infra/logger';
import { findWalletBySub, lockWalletForUpdate } from '@/modules/wallet/wallet.repository';
import { postLedgerEntry } from '@/modules/wallet/ledger';
import { LedgerTxType } from '@/modules/wallet/wallet.types';
import { resolveEffectiveSettings } from '@/modules/merchant/settings.repository';
import { emitEvent } from '@/modules/webhook/webhook.service';

export type SettlementStatus =
  | 'created'
  | 'calculating'
  | 'queued'
  | 'paid'
  | 'partially_paid'
  | 'failed';

type EligibleCollection = {
  id: string;
  amount: number;
  fee_amount: number;
  refund_status: string;
};

async function fetchEligibleCollections(subMerchantId: string): Promise<EligibleCollection[]> {
  const { rows } = await query<{
    id: string;
    amount: string;
    fee_amount: string;
    refund_status: string;
  }>(
    `SELECT id, amount, fee_amount, refund_status
       FROM collections
      WHERE sub_merchant_id = $1
        AND business_status = 'successful'
        AND settlement_eligible = true
        AND settlement_batch_id IS NULL`,
    [subMerchantId],
  );
  return rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    fee_amount: Number(r.fee_amount),
    refund_status: r.refund_status,
  }));
}

/**
 * Create a settlement batch for a sub-merchant and return the persisted row
 * without executing the payout. Separate execute step allows batch review.
 */
export async function createSettlement(input: {
  merchantId: string;
  subMerchantId: string;
}): Promise<{
  settlement_id: string;
  gross: number;
  fees: number;
  settlement_fee: number;
  refund_adjustments: number;
  net: number;
  transaction_count: number;
}> {
  const eligible = await fetchEligibleCollections(input.subMerchantId);
  if (eligible.length === 0) {
    throw OgunError.invalidRequest('No eligible collections to settle');
  }
  const settings = await resolveEffectiveSettings(input.merchantId, input.subMerchantId);

  const gross = eligible.reduce((sum, c) => sum + c.amount, 0);
  const fees = eligible.reduce((sum, c) => sum + c.fee_amount, 0);
  const settlementFee = Math.round((gross * settings.settlement_fee_pct) / 100);

  // Refund adjustments: previously settled collections that have been refunded
  // since the last settlement run. For the MVP we query refunded, already
  // settled collections that have not yet been adjusted.
  const { rows: refundRows } = await query<{ refunded_amount: string; id: string }>(
    `SELECT id, refunded_amount FROM collections
      WHERE sub_merchant_id = $1
        AND refund_status IN ('refunded','partial_refund')
        AND settlement_batch_id IS NOT NULL
        AND refund_timestamp IS NOT NULL
        AND refund_timestamp > COALESCE(
              (SELECT max(period_end) FROM settlements WHERE sub_merchant_id = $1),
              '1970-01-01'::timestamptz
            )`,
    [input.subMerchantId],
  );
  const refundAdjustments = refundRows.reduce((sum, r) => sum + Number(r.refunded_amount ?? 0), 0);

  const net = gross - fees - settlementFee - refundAdjustments;

  const id = newId('settlement');
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 3600 * 1000);

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO settlements
         (id, merchant_id, sub_merchant_id, period_start, period_end,
          gross_amount, fee_amount, settlement_fee, refund_adjustment_amount,
          other_adjustment_amount, net_amount, transaction_count, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,'created')`,
      [
        id,
        input.merchantId,
        input.subMerchantId,
        periodStart,
        periodEnd,
        gross,
        fees,
        settlementFee,
        refundAdjustments,
        net,
        eligible.length,
      ],
    );

    for (const c of eligible) {
      await client.query(
        `INSERT INTO settlement_line_items
           (id, settlement_id, reference_type, reference_id, amount, direction)
         VALUES ($1,$2,'collection',$3,$4,'credit')`,
        [newId('settlementLine'), id, c.id, c.amount],
      );
      await client.query(
        `UPDATE collections SET settlement_batch_id = $2 WHERE id = $1`,
        [c.id, id],
      );
    }

    if (refundAdjustments > 0) {
      for (const r of refundRows) {
        await client.query(
          `INSERT INTO settlement_line_items
             (id, settlement_id, reference_type, reference_id, amount, direction)
           VALUES ($1,$2,'refund_adjustment',$3,$4,'debit')`,
          [newId('settlementLine'), id, r.id, Number(r.refunded_amount ?? 0)],
        );
      }
    }
  });

  logger.info(
    {
      settlement_id: id,
      sub_merchant_id: input.subMerchantId,
      gross,
      fees,
      refund_adjustments: refundAdjustments,
      net,
    },
    'settlement created',
  );

  return {
    settlement_id: id,
    gross,
    fees,
    settlement_fee: settlementFee,
    refund_adjustments: refundAdjustments,
    net,
    transaction_count: eligible.length,
  };
}

/**
 * Execute the settlement by debiting the collection wallet for net_amount.
 * Status transitions: created → queued → paid (or failed if insufficient).
 */
export async function executeSettlement(settlementId: string): Promise<'paid' | 'failed'> {
  type SettlementRow = {
    id: string;
    merchant_id: string;
    sub_merchant_id: string;
    net_amount: string;
    status: SettlementStatus;
  };
  const { rows } = await query<SettlementRow>(
    `SELECT id, merchant_id, sub_merchant_id, net_amount, status
       FROM settlements WHERE id = $1`,
    [settlementId],
  );
  const settlement = rows[0];
  if (!settlement) throw OgunError.notFound('Settlement', settlementId);
  const netAmount = Number(settlement.net_amount);

  const result = await withTransaction(async (client): Promise<'paid' | 'failed'> => {
    const wallet = await findWalletBySub(settlement.sub_merchant_id, 'collection');
    if (!wallet) throw new Error(`No collection wallet for ${settlement.sub_merchant_id}`);
    const locked = await lockWalletForUpdate(client, wallet.id);
    if (locked.available_balance < netAmount) {
      await client.query(
        `UPDATE settlements SET status = 'failed', updated_at = now() WHERE id = $1`,
        [settlementId],
      );
      return 'failed';
    }
    await postLedgerEntry(client, {
      merchantId: settlement.merchant_id,
      subMerchantId: settlement.sub_merchant_id,
      walletId: wallet.id,
      walletType: 'collection',
      transactionType: LedgerTxType.SettlementDebit,
      direction: 'debit',
      amount: netAmount,
      currency: wallet.currency,
      referenceType: 'settlement',
      referenceId: settlementId,
      idempotencyKey: `settlement_debit:${settlementId}`,
      description: `Settlement ${settlementId}`,
    });
    await client.query(
      `UPDATE settlements SET status = 'paid', updated_at = now() WHERE id = $1`,
      [settlementId],
    );
    return 'paid';
  });

  if (result === 'paid') {
    await emitEvent({
      merchantId: settlement.merchant_id,
      type: 'settlement.paid',
      data: {
        settlement_id: settlementId,
        sub_merchant_id: settlement.sub_merchant_id,
        net_amount: netAmount,
      },
    });
  } else {
    await emitEvent({
      merchantId: settlement.merchant_id,
      type: 'settlement.failed',
      data: {
        settlement_id: settlementId,
        sub_merchant_id: settlement.sub_merchant_id,
        failure_reason: 'insufficient_collection_balance',
      },
    });
  }
  return result;
}
