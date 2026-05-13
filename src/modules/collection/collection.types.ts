/**
 * Collection dual-state model (§5.2 / §5.2.1).
 *
 *   internal_status  → lifecycle granularity (detail view only)
 *   business_status  → merchant-facing normalized (list + detail + webhooks)
 */

export const CollectionBusinessStatus = {
  Pending: 'pending',
  Successful: 'successful',
  Failed: 'failed',
  Refunded: 'refunded',
} as const;
export type CollectionBusinessStatusValue =
  (typeof CollectionBusinessStatus)[keyof typeof CollectionBusinessStatus];

export const CollectionInternalStatus = {
  Created: 'created',
  PendingSubmission: 'pending_submission',
  Submitted: 'submitted',
  PendingCustomerAction: 'pending_customer_action',
  Processing: 'processing',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Expired: 'expired',
  Cancelled: 'cancelled',
  TimedOut: 'timed_out',
  Refunded: 'refunded',
  Reversed: 'reversed',
} as const;
export type CollectionInternalStatusValue =
  (typeof CollectionInternalStatus)[keyof typeof CollectionInternalStatus];

/**
 * Map internal → business status per §5.2.1.
 */
export function toBusinessStatus(internal: CollectionInternalStatusValue): CollectionBusinessStatusValue {
  switch (internal) {
    case 'succeeded':
      return 'successful';
    case 'failed':
    case 'expired':
    case 'cancelled':
    case 'timed_out':
      return 'failed';
    case 'refunded':
    case 'reversed':
      return 'refunded';
    default:
      return 'pending';
  }
}

export const TERMINAL_INTERNAL_STATES: readonly CollectionInternalStatusValue[] = [
  'succeeded',
  'failed',
  'expired',
  'cancelled',
  'timed_out',
  'refunded',
  'reversed',
];

export function isTerminal(internal: CollectionInternalStatusValue): boolean {
  return TERMINAL_INTERNAL_STATES.includes(internal);
}

export type CollectionRow = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  amount: number;
  fee_amount: number;
  customer_amount: number;
  currency: string;
  method: string;
  provider: string;
  merchant_reference: string | null;
  provider_reference: string | null;
  provider_call_state: string | null;
  provider_message: string | null;
  next_action: string | null;
  failure_reason: string | null;
  internal_status: CollectionInternalStatusValue;
  business_status: CollectionBusinessStatusValue;
  status_reason: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_email: string | null;
  fee_snapshot: Record<string, unknown>;
  provider_submission_at: Date | null;
  final_resolved_at: Date | null;
  webhook_received_at: Date | null;
  last_webhook_at: Date | null;
  poller_started_at: Date | null;
  last_polled_at: Date | null;
  poll_attempt_count: number;
  polling_stopped_at: Date | null;
  polling_stop_reason: string | null;
  settlement_eligible: boolean;
  settlement_eligible_at: Date | null;
  wallet_credited: boolean;
  wallet_credited_at: Date | null;
  refund_status: 'none' | 'refunded' | 'partial_refund';
  refunded_amount: number | null;
  refund_timestamp: Date | null;
  refund_reference: string | null;
  provider_refund_id: number | null;
  provider_refund_status: string | null;
  settlement_batch_id: string | null;
  metadata: Record<string, unknown> | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
};
