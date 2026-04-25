/**
 * Wizard step model — derived from the backend merchant.status and the
 * presence of various downstream artifacts. The prototype's prototype-only
 * statuses (kyb_in_progress, kyb_approved, settings_configured,
 * ready_for_activation) have been collapsed to backend-real statuses per
 * docs/onboarding-prototype/03-validation-report.md §3.
 */

export type WizardStepKey =
  | 'create'
  | 'people-documents'
  | 'profile'
  | 'settings'
  | 'compliance'
  | 'review'
  | 'activate';

export const STEPS: ReadonlyArray<{
  key: WizardStepKey;
  ordinal: number;
  label: string;
  verb: string;
}> = [
  { key: 'create', ordinal: 0, label: 'Create', verb: 'Identify' },
  { key: 'people-documents', ordinal: 1, label: 'People & Documents', verb: 'Upload' },
  { key: 'profile', ordinal: 2, label: 'Profile', verb: 'Verify' },
  { key: 'settings', ordinal: 3, label: 'Settings', verb: 'Configure' },
  { key: 'compliance', ordinal: 4, label: 'AI Compliance', verb: 'Run' },
  { key: 'review', ordinal: 5, label: 'Review', verb: 'Decide' },
  { key: 'activate', ordinal: 6, label: 'Activate', verb: 'Activate' },
];

/**
 * Derive the "current" step from a merchant's status. Used to land the user
 * at the right step after `/merchants/onboarding/[id]` (no sub-segment).
 *
 * Backend status (source of truth):
 *   draft, submitted, under_ai_review, under_manual_review, changes_requested,
 *   approved, rejected, credentials_issued, active, suspended
 */
export function deriveStepFromStatus(status: string): WizardStepKey {
  switch (status) {
    case 'draft':
      return 'people-documents';
    case 'submitted':
    case 'under_ai_review':
      return 'compliance';
    case 'under_manual_review':
    case 'approved':
      return 'review';
    case 'credentials_issued':
      return 'activate';
    case 'changes_requested':
      return 'people-documents';
    case 'rejected':
      return 'review';
    case 'active':
    case 'suspended':
      return 'activate';
    default:
      return 'people-documents';
  }
}

/**
 * Per-step editability — UI can use this to lock fields once the merchant
 * has progressed past a stage. Mirrors the prototype's STEP_EDIT_MATRIX
 * but keyed by real backend statuses.
 */
export function isStepEditable(status: string, step: WizardStepKey): boolean {
  // Profile + docs: editable in draft + changes_requested only.
  const earlyEditable = status === 'draft' || status === 'changes_requested';
  if (step === 'people-documents' || step === 'profile') return earlyEditable;
  // Settings: editable from approved onwards (post-review).
  if (step === 'settings') {
    return ['approved', 'credentials_issued', 'active'].includes(status);
  }
  // Compliance: AI runs server-side; UI is read-only.
  if (step === 'compliance') return false;
  // Review: only when merchant is awaiting a decision.
  if (step === 'review') {
    return ['submitted', 'under_ai_review', 'under_manual_review', 'approved'].includes(status);
  }
  // Activate: only at credentials_issued (or approved when chaining).
  if (step === 'activate') {
    return ['approved', 'credentials_issued'].includes(status);
  }
  return false;
}

/**
 * Required compliance documents (backend enum: SUPPORTED_DOCUMENT_TYPES).
 * The prototype's `cr12` is removed in favour of per-director `director_id`
 * uploads (drift-analysis §4).
 */
export const REQUIRED_DOC_TYPES = [
  'certificate_of_registration',
  'tax_certificate',
  'director_id',
  'bank_confirmation',
] as const;

export const OPTIONAL_DOC_TYPES = [
  'proof_of_address',
  'business_permit',
  'authority_letter',
  'other',
] as const;

export const ALL_DOC_TYPES = [...REQUIRED_DOC_TYPES, ...OPTIONAL_DOC_TYPES] as const;

export type DocType = (typeof ALL_DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  certificate_of_registration: 'Certificate of Registration',
  tax_certificate: 'Tax Certificate (KRA PIN)',
  director_id: 'Director ID',
  bank_confirmation: 'Bank Confirmation',
  proof_of_address: 'Proof of Address',
  business_permit: 'Business Permit',
  authority_letter: 'Authority Letter',
  other: 'Other',
};
