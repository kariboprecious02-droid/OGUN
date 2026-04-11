/**
 * Payout state machine — Execution Spec §6.1.
 */
export const PayoutStatus = {
  Created: 'created',
  Queued: 'queued',
  Processing: 'processing',
  PendingApproval: 'pending_approval',
  PendingConfirmation: 'pending_confirmation',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Reversed: 'reversed',
  Cancelled: 'cancelled',
} as const;
export type PayoutStatusValue = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export const TERMINAL_PAYOUT_STATES: readonly PayoutStatusValue[] = [
  'succeeded',
  'failed',
  'reversed',
  'cancelled',
];

export function isPayoutTerminal(s: PayoutStatusValue): boolean {
  return TERMINAL_PAYOUT_STATES.includes(s);
}

export type PayoutRow = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  beneficiary_id: string;
  amount: number;
  fee_amount: number;
  total_debit: number;
  recipient_amount: number;
  fee_model: 'merchant_covers' | 'recipient_covers';
  fee_snapshot: Record<string, unknown>;
  currency: string;
  method: string;
  provider: string;
  internal_method: string;
  status: PayoutStatusValue;
  provider_reference: string | null;
  provider_transfer_code: string | null;
  provider_status: string | null;
  external_reference: string | null;
  wallet_reserved_amount: number;
  wallet_reserved_at: Date | null;
  final_resolved_at: Date | null;
  reversal_indicator: boolean;
  reversal_reason: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown> | null;
  fee_model_source: string | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
};
