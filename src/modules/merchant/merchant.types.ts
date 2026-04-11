/**
 * Merchant onboarding state machine — Execution Spec §4.1.
 *
 *   draft → submitted → under_ai_review → under_manual_review → approved → credentials_issued → active
 *   Alt:   under_ai_review | under_manual_review → changes_requested | rejected
 *          active → suspended
 *          changes_requested → submitted (after resubmit)
 */
export const MerchantStatus = {
  Draft: 'draft',
  Submitted: 'submitted',
  UnderAiReview: 'under_ai_review',
  UnderManualReview: 'under_manual_review',
  ChangesRequested: 'changes_requested',
  Approved: 'approved',
  Rejected: 'rejected',
  CredentialsIssued: 'credentials_issued',
  Active: 'active',
  Suspended: 'suspended',
} as const;

export type MerchantStatusValue = (typeof MerchantStatus)[keyof typeof MerchantStatus];

/** Allowed transitions out of each state. */
export const MERCHANT_TRANSITIONS: Record<MerchantStatusValue, readonly MerchantStatusValue[]> = {
  draft: ['submitted'],
  submitted: ['under_ai_review'],
  under_ai_review: ['under_manual_review', 'changes_requested', 'rejected'],
  under_manual_review: ['approved', 'changes_requested', 'rejected'],
  changes_requested: ['submitted'],
  approved: ['credentials_issued'],
  credentials_issued: ['active'],
  rejected: ['draft'],
  active: ['suspended'],
  suspended: ['active'],
};

export function canTransition(from: MerchantStatusValue, to: MerchantStatusValue): boolean {
  return MERCHANT_TRANSITIONS[from].includes(to);
}

export type MerchantRow = {
  id: string;
  legal_name: string;
  trading_name: string;
  registration_number: string | null;
  tax_id: string | null;
  country: string;
  settlement_currency: string;
  business_category: string | null;
  business_address: Record<string, unknown> | null;
  website_url: string | null;
  expected_monthly_volume: number | null;
  expected_avg_ticket: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: MerchantStatusValue;
  created_at: Date;
  updated_at: Date;
};

export type SubMerchantRow = {
  id: string;
  merchant_id: string;
  name: string;
  code: string | null;
  status: 'draft' | 'active' | 'suspended' | 'closed';
  settlement_preference: 'daily' | 'weekly' | 'monthly' | 'on_demand' | null;
  settlement_destination: Record<string, unknown> | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: Date;
  updated_at: Date;
};
