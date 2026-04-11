import type { PoolClient } from 'pg';
import { newId } from '@/infra/ids';
import { LedgerEntry, LedgerTxType, LedgerTxTypeValue, LedgerDirection, WalletType } from './wallet.types';
import { adjustWalletBalance } from './wallet.repository';
import { query } from '@/infra/db/pool';

/**
 * Immutable, append-only ledger (§3.5 / §2.4).
 *
 * - Every posting uses an idempotency_key; duplicate posts are silent no-ops.
 * - Wallet balances are updated in the SAME transaction as the entry insert.
 * - The wallet invariant is: available_balance = SUM(posted non-reserved
 *   entries). Reservation entries (payout_reserve / payout_release) only
 *   move `reserved_balance`, not `available_balance`.
 */

type PostingParams = {
  merchantId: string;
  subMerchantId: string;
  walletId: string;
  walletType: WalletType;
  transactionType: LedgerTxTypeValue;
  direction: LedgerDirection;
  amount: number;
  currency: string;
  referenceType: LedgerEntry['reference_type'];
  referenceId: string;
  idempotencyKey: string;
  description?: string;
};

/** Map transaction types → (availableDelta, reservedDelta) multipliers. */
function deltasFor(
  txType: LedgerTxTypeValue,
  direction: LedgerDirection,
  amount: number,
): { available: number; reserved: number } {
  const signed = direction === 'credit' ? amount : -amount;
  switch (txType) {
    case LedgerTxType.PayoutReserve:
      // Moves funds from available -> reserved
      return { available: -amount, reserved: amount };
    case LedgerTxType.PayoutRelease:
      // Releases reserved back to available
      return { available: amount, reserved: -amount };
    case LedgerTxType.PayoutPrincipalDebit:
    case LedgerTxType.PayoutFeeDebit:
      // Finalizes a reserved amount: remove from reserved (no effect on
      // available, funds were already moved on reserve).
      return { available: 0, reserved: -amount };
    case LedgerTxType.PayoutReversalCredit:
    case LedgerTxType.PayoutFeeReversalCredit:
      // Restores available (reversal after success)
      return { available: amount, reserved: 0 };
    default:
      return { available: signed, reserved: 0 };
  }
}

export async function postLedgerEntry(client: PoolClient, params: PostingParams): Promise<boolean> {
  // Idempotent: UNIQUE constraint on idempotency_key - ON CONFLICT DO NOTHING
  const id = newId('ledgerEntry');
  const res = await client.query(
    `INSERT INTO ledger_entries
       (id, merchant_id, sub_merchant_id, wallet_id, wallet_type,
        transaction_type, direction, amount, currency,
        reference_type, reference_id, idempotency_key, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      id,
      params.merchantId,
      params.subMerchantId,
      params.walletId,
      params.walletType,
      params.transactionType,
      params.direction,
      params.amount,
      params.currency,
      params.referenceType,
      params.referenceId,
      params.idempotencyKey,
      params.description ?? null,
    ],
  );
  if (res.rowCount === 0) {
    // Duplicate: no-op
    return false;
  }
  const { available, reserved } = deltasFor(params.transactionType, params.direction, params.amount);
  if (available !== 0 || reserved !== 0) {
    await adjustWalletBalance(client, params.walletId, available, reserved);
  }
  return true;
}

/**
 * Reconciliation helper (§3.5 invariant). Recomputes available/reserved
 * balances from the full ledger for a wallet and returns both.
 * Does not mutate state.
 */
export async function deriveWalletBalance(walletId: string): Promise<{
  available: number;
  reserved: number;
}> {
  const { rows } = await query<{
    available: string | null;
    reserved: string | null;
  }>(
    `SELECT
        COALESCE(SUM(
          CASE
            WHEN transaction_type IN ('payout_reserve') THEN -amount
            WHEN transaction_type IN ('payout_release','payout_reversal_credit','payout_fee_reversal_credit') THEN amount
            WHEN transaction_type IN ('payout_principal_debit','payout_fee_debit') THEN 0
            WHEN direction = 'credit' THEN amount
            WHEN direction = 'debit' THEN -amount
          END
        ), 0) AS available,
        COALESCE(SUM(
          CASE
            WHEN transaction_type = 'payout_reserve' THEN amount
            WHEN transaction_type IN ('payout_release','payout_principal_debit','payout_fee_debit') THEN -amount
            ELSE 0
          END
        ), 0) AS reserved
      FROM ledger_entries
      WHERE wallet_id = $1`,
    [walletId],
  );
  return {
    available: Number(rows[0].available ?? 0),
    reserved: Number(rows[0].reserved ?? 0),
  };
}
