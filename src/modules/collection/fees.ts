/**
 * Fee calculation (§5.7).
 *
 *   collection_fee_model = merchant_covers:
 *     customer_amount = amount
 *     wallet_credit   = amount - fee_amount
 *
 *   collection_fee_model = payer_covers:
 *     customer_amount = amount + fee_amount
 *     wallet_credit   = amount
 */

export type CollectionFeeModel = 'merchant_covers' | 'payer_covers';

export type CollectionFeeSnapshot = {
  model: CollectionFeeModel;
  fee_pct: number;
  fee_amount: number;
  amount: number;
  customer_amount: number;
  wallet_credit: number;
  currency: string;
};

export function computeCollectionFee(
  amount: number,
  feePct: number,
  model: CollectionFeeModel,
  currency: string,
): CollectionFeeSnapshot {
  const fee = Math.round((amount * feePct) / 100);
  const customer = model === 'payer_covers' ? amount + fee : amount;
  const credit = model === 'payer_covers' ? amount : amount - fee;
  return {
    model,
    fee_pct: feePct,
    fee_amount: fee,
    amount,
    customer_amount: customer,
    wallet_credit: credit,
    currency,
  };
}

/**
 * Payout fee calculation (§6.4).
 *
 *   recipient_covers:
 *     total_debit      = amount
 *     recipient_amount = amount - fee_amount
 *
 *   merchant_covers:
 *     total_debit      = amount + fee_amount
 *     recipient_amount = amount
 */
export type PayoutFeeModel = 'merchant_covers' | 'recipient_covers';

export type PayoutFeeSnapshot = {
  model: PayoutFeeModel;
  fee_pct: number;
  fee_amount: number;
  amount: number;
  total_debit: number;
  recipient_amount: number;
  currency: string;
};

export function computePayoutFee(
  amount: number,
  feePct: number,
  model: PayoutFeeModel,
  currency: string,
): PayoutFeeSnapshot {
  const fee = Math.round((amount * feePct) / 100);
  const totalDebit = model === 'merchant_covers' ? amount + fee : amount;
  const recipient = model === 'recipient_covers' ? amount - fee : amount;
  return {
    model,
    fee_pct: feePct,
    fee_amount: fee,
    amount,
    total_debit: totalDebit,
    recipient_amount: recipient,
    currency,
  };
}
