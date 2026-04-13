/**
 * Ogun API client for server components.
 *
 * This thin wrapper around fetch() handles:
 *   - Base URL resolution (OGUN_API_BASE_URL)
 *   - X-Ogun-Admin-Secret injection from the httpOnly cookie
 *   - JSON envelope unwrapping ({ status, data, meta })
 *   - Typed error throwing for non-2xx responses
 *
 * Used exclusively from server components + server actions so the
 * admin secret never reaches the browser.
 */

import { cookies } from 'next/headers';

const BASE_URL = process.env.OGUN_API_BASE_URL || 'http://localhost:4000/v1';
const ADMIN_COOKIE = 'ogun_admin_secret';
// Server-side admin secret. Falls back to the API's default so the dashboard
// works out-of-the-box without env wiring. Override with OGUN_ADMIN_SECRET
// in the admin service env once a proper secret is set.
// SERVER-ONLY — never prefix with NEXT_PUBLIC_ so it can't leak to the browser.
const SERVER_ADMIN_SECRET = process.env.OGUN_ADMIN_SECRET || 'changeme-set-in-prod';

export class OgunApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Envelope<T> =
  | { status: 'success'; data: T; meta: Record<string, unknown> }
  | {
      status: 'error';
      error: { code: string; message: string; details?: Record<string, unknown> };
      meta: Record<string, unknown>;
    };

async function request<T>(
  path: string,
  init: RequestInit & { adminSecret?: string } = {},
): Promise<T> {
  const cookieStore = await cookies();
  // Precedence: explicit override → cookie (legacy) → server env default.
  // The env default makes login optional: the dashboard works for anyone
  // who can reach the URL. Re-add login later by gating at a proxy/IAP.
  const secret =
    init.adminSecret ?? cookieStore.get(ADMIN_COOKIE)?.value ?? SERVER_ADMIN_SECRET;
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (secret) headers['X-Ogun-Admin-Secret'] = secret;

  const res = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const body = (await res.json()) as Envelope<T>;
  if (body.status === 'error' || !res.ok) {
    const err = 'error' in body ? body.error : { code: 'internal_error', message: res.statusText };
    throw new OgunApiError(err.code, err.message, res.status, err.details);
  }
  return body.data;
}

/* ---------- Typed helpers ---------- */

export type MerchantSummary = {
  id: string;
  legal_name: string;
  trading_name: string;
  status: string;
  country: string;
  created_at: string;
  updated_at: string;
};

export type MerchantDetail = {
  merchant: MerchantSummary & {
    registration_number: string | null;
    tax_id: string | null;
    contact_email: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    business_category: string | null;
    settlement_currency: string;
  };
  sub_merchants: Array<{
    id: string;
    name: string;
    code: string | null;
    status: string;
    settlement_preference: string | null;
  }>;
  documents: Array<{
    id: string;
    type: string;
    file_url: string;
    file_hash: string | null;
    extracted_data: Record<string, unknown> | null;
    extraction_confidence: number | null;
    review_status: string;
    uploaded_at: string;
  }>;
  rule_results: Array<{
    id: string;
    rule_name: string;
    passed: boolean;
    details: Record<string, unknown>;
    created_at: string;
  }>;
  reviews: Array<{
    id: string;
    reviewer_type: string;
    decision: string;
    notes: string | null;
    confidence_score: number | null;
    flags_raised: unknown;
    explanation_summary: string | null;
    model_identifier: string | null;
    actor_id: string | null;
    previous_status: string | null;
    new_status: string | null;
    created_at: string;
  }>;
};

export type WalletSummary = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  wallet_type: 'collection' | 'payout';
  currency: string;
  available_balance: number;
  reserved_balance: number;
  status: string;
  sub_merchant_name: string;
  merchant_legal_name: string;
};

export type LedgerEntry = {
  id: string;
  transaction_type: string;
  direction: 'credit' | 'debit';
  amount: number;
  currency: string;
  reference_type: string;
  reference_id: string;
  description: string | null;
  created_at: string;
};

export type CollectionSummary = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  amount: number;
  fee_amount: number;
  currency: string;
  method: string;
  provider: string;
  business_status: 'pending' | 'successful' | 'failed' | 'refunded';
  internal_status: string;
  status_reason: string | null;
  customer_phone: string;
  merchant_reference: string | null;
  settlement_eligible: boolean;
  wallet_credited: boolean;
  refund_status: string;
  created_at: string;
  final_resolved_at: string | null;
};

export type PayoutSummary = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  amount: number;
  fee_amount: number;
  total_debit: number;
  recipient_amount: number;
  fee_model: 'merchant_covers' | 'recipient_covers';
  currency: string;
  method: string;
  provider: string;
  status: string;
  provider_reference: string | null;
  provider_status: string | null;
  failure_reason: string | null;
  reversal_indicator: boolean;
  created_at: string;
  final_resolved_at: string | null;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};

async function paged<T>(path: string): Promise<Paginated<T>> {
  const cookieStore = await cookies();
  // Match the auth fallback chain used by request<T>() — cookie first
  // (legacy sessions), then server-side env default. Without this,
  // listMerchants / listWallets / listCollections / listPayouts all
  // send an empty secret and get 403ed, crashing every server page.
  const secret = cookieStore.get(ADMIN_COOKIE)?.value ?? SERVER_ADMIN_SECRET;
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'X-Ogun-Admin-Secret': secret },
    cache: 'no-store',
  });
  const body = (await res.json()) as
    | { status: 'success'; data: T[]; meta: { page: number; limit: number; total: number } }
    | { status: 'error'; error: { code: string; message: string } };
  if (body.status === 'error') {
    throw new OgunApiError(body.error.code, body.error.message, res.status);
  }
  return {
    items: body.data,
    page: body.meta.page,
    limit: body.meta.limit,
    total: body.meta.total,
  };
}

/* ---------- Admin endpoints ---------- */

export async function verifyAdminSession(secret: string): Promise<boolean> {
  try {
    await request<{ authenticated: boolean }>('/admin/session', {
      method: 'POST',
      adminSecret: secret,
    });
    return true;
  } catch {
    return false;
  }
}

export async function listMerchants(params: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
} = {}): Promise<Paginated<MerchantSummary>> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.status) qs.set('status', params.status);
  if (params.search) qs.set('search', params.search);
  return paged<MerchantSummary>(`/admin/merchants?${qs.toString()}`);
}

export type CreateMerchantInput = {
  legal_name: string;
  trading_name: string;
  registration_number?: string;
  tax_id?: string;
  country?: string;
  settlement_currency?: string;
  business_category?: string;
  business_address?: {
    street?: string;
    city?: string;
    county?: string;
    postal_code?: string;
  };
  website_url?: string;
  expected_monthly_volume?: number;
  expected_avg_ticket?: number;
  contact?: { name?: string; email?: string; phone?: string };
  notification_emails?: string[];
};

export async function createMerchantAsAdmin(
  input: CreateMerchantInput,
): Promise<{ id: string; status: string; legal_name: string }> {
  return request<{ id: string; status: string; legal_name: string }>('/admin/merchants', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getMerchantDetail(id: string): Promise<MerchantDetail> {
  return request<MerchantDetail>(`/admin/merchants/${id}`);
}

export async function submitComplianceDecision(
  merchantId: string,
  decision: 'approve' | 'changes_requested' | 'reject',
  notes: string,
): Promise<void> {
  await request(`/admin/compliance-reviews/${merchantId}`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes }),
  });
}

export async function activateMerchant(
  merchantId: string,
): Promise<{ merchant: { id: string; status: string } }> {
  return request<{ merchant: { id: string; status: string } }>(
    `/admin/merchants/${merchantId}/activate`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export async function listWallets(params: {
  page?: number;
  limit?: number;
  merchant_id?: string;
  sub_merchant_id?: string;
  wallet_type?: 'collection' | 'payout';
} = {}): Promise<Paginated<WalletSummary>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return paged<WalletSummary>(`/admin/wallets?${qs.toString()}`);
}

export async function getWalletLedger(
  walletId: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<LedgerEntry>> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  return paged<LedgerEntry>(`/admin/wallets/${walletId}/ledger?${qs.toString()}`);
}

export async function listCollections(params: {
  page?: number;
  limit?: number;
  merchant_id?: string;
  sub_merchant_id?: string;
  business_status?: string;
} = {}): Promise<Paginated<CollectionSummary>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return paged<CollectionSummary>(`/admin/collections?${qs.toString()}`);
}

export async function listPayouts(params: {
  page?: number;
  limit?: number;
  merchant_id?: string;
  sub_merchant_id?: string;
  status?: string;
} = {}): Promise<Paginated<PayoutSummary>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return paged<PayoutSummary>(`/admin/payouts?${qs.toString()}`);
}
