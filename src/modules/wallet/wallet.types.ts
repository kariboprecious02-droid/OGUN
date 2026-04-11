export type WalletType = 'collection' | 'payout';
export type WalletStatus = 'active' | 'suspended' | 'closed';

export type WalletRow = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  wallet_type: WalletType;
  currency: string;
  available_balance: number | string; // PG bigint -> string, normalized in service
  reserved_balance: number | string;
  status: WalletStatus;
  created_at: Date;
  updated_at: Date;
};

/**
 * Ledger entry transaction types — Execution Spec §3.5.
 */
export const LedgerTxType = {
  CollectionCredit: 'collection_credit',
  CollectionFeeDebit: 'collection_fee_debit',
  SettlementDebit: 'settlement_debit',
  PayoutWalletTopupCredit: 'payout_wallet_topup_credit',
  PayoutReserve: 'payout_reserve',
  PayoutRelease: 'payout_release',
  PayoutPrincipalDebit: 'payout_principal_debit',
  PayoutFeeDebit: 'payout_fee_debit',
  PayoutReversalCredit: 'payout_reversal_credit',
  PayoutFeeReversalCredit: 'payout_fee_reversal_credit',
  RefundAdjustmentDebit: 'refund_adjustment_debit',
  ManualAdjustment: 'manual_adjustment',
} as const;

export type LedgerTxTypeValue = (typeof LedgerTxType)[keyof typeof LedgerTxType];

export type LedgerDirection = 'credit' | 'debit';

export type LedgerEntry = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  wallet_id: string;
  wallet_type: WalletType;
  transaction_type: LedgerTxTypeValue;
  direction: LedgerDirection;
  amount: number; // always positive
  currency: string;
  reference_type: 'collection' | 'payout' | 'settlement' | 'topup' | 'adjustment' | 'refund';
  reference_id: string;
  idempotency_key?: string | null;
  description?: string | null;
};
