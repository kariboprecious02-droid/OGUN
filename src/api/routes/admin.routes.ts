/**
 * Admin routes — these are gated behind an out-of-band admin auth
 * mechanism (session-based in the dashboard).  In MVP we gate them by
 * a shared admin secret header.
 */
import { Router } from 'express';
import { z } from 'zod';
import { parseBody, parseQuery, pagination, resolvePagination } from '@/api/validation';
import { success, paginated } from '@/infra/response';
import { OgunError } from '@/infra/errors';
import { submitManualDecision, runCompliancePipeline } from '@/modules/compliance/compliance.service';
import {
  activateMerchant,
  suspendMerchant,
  getMerchant,
  createMerchant,
  createSubMerchant,
  transitionMerchant,
  updateMerchantProfile,
} from '@/modules/merchant/merchant.service';
import { MerchantStatus } from '@/modules/merchant/merchant.types';
import { issueCredentials, rotateKey } from '@/modules/auth/auth.service';
import { upsertSettings, resolveEffectiveSettings } from '@/modules/merchant/settings.repository';
import {
  uploadDocument,
  SUPPORTED_DOCUMENT_TYPES,
  DocumentType,
} from '@/modules/document/document.service';
import { newId } from '@/infra/ids';
import multer from 'multer';
import { config } from '@/infra/config';
import { query } from '@/infra/db/pool';

const router = Router();

function requireAdmin(req: import('express').Request): void {
  const header = req.header('X-Ogun-Admin-Secret');
  // Accept the dedicated admin secret. Also accept webhookSigningSalt as a
  // transitional fallback so any deployments still wired to the old secret
  // don't break during rollout — remove the fallback once all envs have
  // OGUN_ADMIN_SECRET set explicitly.
  const valid =
    header === config.platform.adminSecret ||
    header === config.platform.webhookSigningSalt;
  if (!header || !valid) {
    throw OgunError.forbidden('Admin authentication required');
  }
}

const reviewBody = z.object({
  decision: z.enum(['approve', 'changes_requested', 'reject']),
  notes: z.string().max(2000),
  actor_id: z.string().optional(),
});

/**
 * POST /v1/admin/merchants — admin-authenticated merchant creation.
 *
 * The public POST /v1/merchants endpoint requires a merchant secret
 * key, which creates a chicken-and-egg problem for bootstrapping the
 * very first merchant and for admin-initiated onboarding from the
 * dashboard. This endpoint accepts the same body schema but validates
 * via X-Ogun-Admin-Secret instead.
 */
const adminCreateMerchantBody = z.object({
  legal_name: z.string().min(2),
  trading_name: z.string().min(2),
  registration_number: z.string().optional(),
  tax_id: z.string().optional(),
  country: z.string().length(2).optional(),
  settlement_currency: z.string().length(3).optional(),
  business_category: z.string().optional(),
  business_address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      county: z.string().optional(),
      postal_code: z.string().optional(),
    })
    .optional(),
  website_url: z.string().url().optional(),
  expected_monthly_volume: z.number().int().nonnegative().optional(),
  expected_avg_ticket: z.number().int().nonnegative().optional(),
  contact: z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  notification_emails: z.array(z.string().email()).optional(),
});

router.post('/admin/merchants', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(adminCreateMerchantBody, req.body);
    const merchant = await createMerchant(body);
    res.status(201).json(
      success(
        { id: merchant.id, status: merchant.status, legal_name: merchant.legal_name },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

router.post('/admin/compliance-reviews/:merchantId', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(reviewBody, req.body);
    const nextStatus = await submitManualDecision(
      req.params.merchantId,
      body.decision,
      body.notes,
      body.actor_id,
    );
    res.json(
      success(
        { merchant_id: req.params.merchantId, status: nextStatus },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

router.post('/admin/merchants/:merchantId/credentials', async (req, res, next) => {
  try {
    requireAdmin(req);
    const credentials = await issueCredentials(req.params.merchantId);
    res.status(201).json(success(credentials, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.post('/admin/merchants/:merchantId/activate', async (req, res, next) => {
  try {
    requireAdmin(req);
    const result = await activateMerchant(req.params.merchantId);
    res.json(
      success(
        {
          merchant: { id: result.merchant.id, status: result.merchant.status },
          credentials: result.credentials,
          sub_merchants: result.subMerchants.map((s) => ({ id: s.id, status: s.status })),
        },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

const suspendBody = z.object({ reason: z.string().min(1) });

router.post('/admin/merchants/:merchantId/suspend', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(suspendBody, req.body);
    const updated = await suspendMerchant(req.params.merchantId, body.reason);
    res.json(success({ id: updated.id, status: updated.status }, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/* ---------- READ endpoints for the admin dashboard ---------- */

/**
 * GET /v1/admin/merchants — paginated list, optionally filtered by
 * status. Used for the compliance review queue.
 */
const listMerchantsQuery = pagination.extend({
  status: z
    .enum([
      'draft',
      'submitted',
      'under_ai_review',
      'under_manual_review',
      'changes_requested',
      'approved',
      'rejected',
      'credentials_issued',
      'active',
      'suspended',
    ])
    .optional(),
  search: z.string().max(100).optional(),
});

router.get('/admin/merchants', async (req, res, next) => {
  try {
    requireAdmin(req);
    const parsed = parseQuery(listMerchantsQuery, req.query);
    const { page, limit } = resolvePagination(parsed);
    const where: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (parsed.status) {
      where.push(`status = $${i++}`);
      vals.push(parsed.status);
    }
    if (parsed.search) {
      where.push(`(legal_name ILIKE $${i} OR trading_name ILIKE $${i} OR id = $${i + 1})`);
      vals.push(`%${parsed.search}%`);
      vals.push(parsed.search);
      i += 2;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const [{ rows: items }, { rows: totals }] = await Promise.all([
      query<{
        id: string;
        legal_name: string;
        trading_name: string;
        status: string;
        country: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, legal_name, trading_name, status, country, created_at, updated_at
           FROM merchants ${whereSql}
          ORDER BY updated_at DESC
          LIMIT $${i++} OFFSET $${i++}`,
        [...vals, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT count(*)::text AS count FROM merchants ${whereSql}`,
        vals,
      ),
    ]);
    res.json(
      paginated(items, page, limit, Number(totals[0]?.count ?? 0), req.ogunContext.requestId),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/admin/merchants/:id — full merchant profile with documents,
 * rule results, AI review, sub-merchants, and settings.  Powers the
 * compliance review detail screen.
 */
router.get('/admin/merchants/:id', async (req, res, next) => {
  try {
    requireAdmin(req);
    const merchant = await getMerchant(req.params.id);
    const [docs, rules, reviews, subs] = await Promise.all([
      query<{
        id: string;
        type: string;
        file_url: string;
        file_hash: string | null;
        extracted_data: Record<string, unknown> | null;
        extraction_confidence: number | null;
        review_status: string;
        uploaded_at: Date;
      }>(
        `SELECT id, type, file_url, file_hash, extracted_data,
                extraction_confidence, review_status, uploaded_at
           FROM documents WHERE merchant_id = $1
           ORDER BY uploaded_at DESC`,
        [merchant.id],
      ),
      query<{
        id: string;
        rule_name: string;
        passed: boolean;
        details: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT id, rule_name, passed, details, created_at
           FROM compliance_rule_results WHERE merchant_id = $1
           ORDER BY created_at DESC`,
        [merchant.id],
      ),
      query<{
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
        created_at: Date;
      }>(
        `SELECT id, reviewer_type, decision, notes, confidence_score,
                flags_raised, explanation_summary, model_identifier,
                actor_id, previous_status, new_status, created_at
           FROM compliance_reviews WHERE merchant_id = $1
           ORDER BY created_at DESC`,
        [merchant.id],
      ),
      query<{
        id: string;
        name: string;
        code: string | null;
        status: string;
        settlement_preference: string | null;
      }>(
        `SELECT id, name, code, status, settlement_preference
           FROM sub_merchants WHERE merchant_id = $1
           ORDER BY created_at ASC`,
        [merchant.id],
      ),
    ]);
    // Normalize bigint columns to numbers for JSON safety (pg driver
    // returns bigint as string).
    const normalizedMerchant = {
      ...merchant,
      expected_monthly_volume: merchant.expected_monthly_volume != null
        ? Number(merchant.expected_monthly_volume) : null,
      expected_avg_ticket: merchant.expected_avg_ticket != null
        ? Number(merchant.expected_avg_ticket) : null,
    };
    res.json(
      success(
        {
          merchant: normalizedMerchant,
          sub_merchants: subs.rows,
          documents: docs.rows,
          rule_results: rules.rows,
          reviews: reviews.rows,
        },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/admin/wallets — cross-merchant wallet inspector.
 */
const listWalletsQuery = pagination.extend({
  merchant_id: z.string().startsWith('mrc_').optional(),
  sub_merchant_id: z.string().startsWith('smrc_').optional(),
  wallet_type: z.enum(['collection', 'payout']).optional(),
});

router.get('/admin/wallets', async (req, res, next) => {
  try {
    requireAdmin(req);
    const parsed = parseQuery(listWalletsQuery, req.query);
    const { page, limit } = resolvePagination(parsed);
    const where: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (parsed.merchant_id) {
      where.push(`w.merchant_id = $${i++}`);
      vals.push(parsed.merchant_id);
    }
    if (parsed.sub_merchant_id) {
      where.push(`w.sub_merchant_id = $${i++}`);
      vals.push(parsed.sub_merchant_id);
    }
    if (parsed.wallet_type) {
      where.push(`w.wallet_type = $${i++}`);
      vals.push(parsed.wallet_type);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const [{ rows: items }, { rows: totals }] = await Promise.all([
      query<{
        id: string;
        merchant_id: string;
        sub_merchant_id: string;
        wallet_type: string;
        currency: string;
        available_balance: string;
        reserved_balance: string;
        status: string;
        sub_merchant_name: string;
        merchant_legal_name: string;
      }>(
        `SELECT w.id, w.merchant_id, w.sub_merchant_id, w.wallet_type, w.currency,
                w.available_balance, w.reserved_balance, w.status,
                sm.name AS sub_merchant_name,
                m.legal_name AS merchant_legal_name
           FROM wallets w
           JOIN sub_merchants sm ON sm.id = w.sub_merchant_id
           JOIN merchants m ON m.id = w.merchant_id
           ${whereSql}
          ORDER BY m.legal_name, sm.name, w.wallet_type
          LIMIT $${i++} OFFSET $${i++}`,
        [...vals, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT count(*)::text AS count FROM wallets w ${whereSql}`,
        vals,
      ),
    ]);
    const normalized = items.map((w) => ({
      ...w,
      available_balance: Number(w.available_balance),
      reserved_balance: Number(w.reserved_balance),
    }));
    res.json(
      paginated(normalized, page, limit, Number(totals[0]?.count ?? 0), req.ogunContext.requestId),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/admin/wallets/:id/ledger — paginated ledger entries for a
 * specific wallet.  Reference link for investigating drift.
 */
router.get('/admin/wallets/:id/ledger', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { page, limit } = resolvePagination(parseQuery(pagination, req.query));
    const offset = (page - 1) * limit;
    const [{ rows: items }, { rows: totals }] = await Promise.all([
      query<{
        id: string;
        transaction_type: string;
        direction: string;
        amount: string;
        currency: string;
        reference_type: string;
        reference_id: string;
        description: string | null;
        created_at: Date;
      }>(
        `SELECT id, transaction_type, direction, amount, currency,
                reference_type, reference_id, description, created_at
           FROM ledger_entries
          WHERE wallet_id = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [req.params.id, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ledger_entries WHERE wallet_id = $1`,
        [req.params.id],
      ),
    ]);
    const normalized = items.map((e) => ({ ...e, amount: Number(e.amount) }));
    res.json(
      paginated(normalized, page, limit, Number(totals[0]?.count ?? 0), req.ogunContext.requestId),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/admin/collections — cross-merchant transaction inspector.
 */
const listCollectionsQuery = pagination.extend({
  merchant_id: z.string().startsWith('mrc_').optional(),
  sub_merchant_id: z.string().startsWith('smrc_').optional(),
  business_status: z.enum(['pending', 'successful', 'failed', 'refunded']).optional(),
});

router.get('/admin/collections', async (req, res, next) => {
  try {
    requireAdmin(req);
    const parsed = parseQuery(listCollectionsQuery, req.query);
    const { page, limit } = resolvePagination(parsed);
    const where: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (parsed.merchant_id) {
      where.push(`merchant_id = $${i++}`);
      vals.push(parsed.merchant_id);
    }
    if (parsed.sub_merchant_id) {
      where.push(`sub_merchant_id = $${i++}`);
      vals.push(parsed.sub_merchant_id);
    }
    if (parsed.business_status) {
      where.push(`business_status = $${i++}`);
      vals.push(parsed.business_status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const [{ rows: items }, { rows: totals }] = await Promise.all([
      query(
        `SELECT id, merchant_id, sub_merchant_id, amount, fee_amount, currency,
                method, provider, business_status, internal_status, status_reason,
                customer_phone, merchant_reference, settlement_eligible,
                wallet_credited, refund_status, created_at, final_resolved_at
           FROM collections ${whereSql}
          ORDER BY created_at DESC
          LIMIT $${i++} OFFSET $${i++}`,
        [...vals, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT count(*)::text AS count FROM collections ${whereSql}`,
        vals,
      ),
    ]);
    const normalized = items.map((c: Record<string, unknown>) => ({
      ...c,
      amount: Number(c.amount),
      fee_amount: Number(c.fee_amount),
    }));
    res.json(
      paginated(normalized, page, limit, Number(totals[0]?.count ?? 0), req.ogunContext.requestId),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/admin/payouts — cross-merchant payout inspector.
 */
const listPayoutsQuery = pagination.extend({
  merchant_id: z.string().startsWith('mrc_').optional(),
  sub_merchant_id: z.string().startsWith('smrc_').optional(),
  status: z
    .enum([
      'created',
      'queued',
      'processing',
      'pending_approval',
      'pending_confirmation',
      'succeeded',
      'failed',
      'reversed',
      'cancelled',
    ])
    .optional(),
});

router.get('/admin/payouts', async (req, res, next) => {
  try {
    requireAdmin(req);
    const parsed = parseQuery(listPayoutsQuery, req.query);
    const { page, limit } = resolvePagination(parsed);
    const where: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (parsed.merchant_id) {
      where.push(`merchant_id = $${i++}`);
      vals.push(parsed.merchant_id);
    }
    if (parsed.sub_merchant_id) {
      where.push(`sub_merchant_id = $${i++}`);
      vals.push(parsed.sub_merchant_id);
    }
    if (parsed.status) {
      where.push(`status = $${i++}`);
      vals.push(parsed.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const [{ rows: items }, { rows: totals }] = await Promise.all([
      query(
        `SELECT id, merchant_id, sub_merchant_id, amount, fee_amount, total_debit,
                recipient_amount, fee_model, currency, method, provider, status,
                provider_reference, provider_status, failure_reason, reversal_indicator,
                created_at, final_resolved_at
           FROM payouts ${whereSql}
          ORDER BY created_at DESC
          LIMIT $${i++} OFFSET $${i++}`,
        [...vals, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT count(*)::text AS count FROM payouts ${whereSql}`,
        vals,
      ),
    ]);
    const normalized = items.map((p: Record<string, unknown>) => ({
      ...p,
      amount: Number(p.amount),
      fee_amount: Number(p.fee_amount),
      total_debit: Number(p.total_debit),
      recipient_amount: Number(p.recipient_amount),
    }));
    res.json(
      paginated(normalized, page, limit, Number(totals[0]?.count ?? 0), req.ogunContext.requestId),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/admin/session — admin login that exchanges the admin secret
 * for a confirmation. The Next.js dashboard stores the secret in a
 * httpOnly cookie so subsequent requests can include it server-side.
 * This endpoint simply validates the secret and echoes the admin's
 * context back to the client.
 */
router.post('/admin/session', async (req, res, next) => {
  try {
    requireAdmin(req);
    res.json(
      success(
        { authenticated: true, verified_at: new Date().toISOString() },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

/* ============================================================================
 * Admin-mirror routes — admin-authenticated equivalents of the merchant-secret
 * routes in merchants.routes.ts and documents.routes.ts. Used by the admin
 * onboarding wizard to drive the full merchant lifecycle without needing the
 * merchant's own sk_* key (which doesn't exist before activation anyway).
 *
 * Each handler reuses the same service function as its merchant-side twin —
 * only the auth layer differs (requireAdmin vs requireSecretKey).
 * ========================================================================== */

const adminUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function shapeDocument(d: Awaited<ReturnType<typeof uploadDocument>>) {
  return {
    id: d.id,
    merchant_id: d.merchant_id,
    sub_merchant_id: d.sub_merchant_id,
    type: d.type,
    file_url: d.file_url,
    file_hash: d.file_hash,
    review_status: d.review_status,
    extracted_data: d.extracted_data,
    extraction_confidence: d.extraction_confidence,
    uploaded_at: d.uploaded_at,
  };
}

/**
 * POST /v1/admin/merchants/:merchantId/documents — admin uploads a compliance
 * document on behalf of a merchant. Same multipart contract as the
 * merchant-side route (`file` + `type` + optional `sub_merchant_id`).
 */
router.post(
  '/admin/merchants/:merchantId/documents',
  adminUpload.single('file'),
  async (req, res, next) => {
    try {
      requireAdmin(req);
      const file = req.file;
      if (!file) {
        throw OgunError.invalidRequest('Missing file field in multipart body');
      }
      const rawType = (req.body as Record<string, unknown>).type;
      const type = typeof rawType === 'string' ? rawType : '';
      if (!SUPPORTED_DOCUMENT_TYPES.includes(type as DocumentType)) {
        throw OgunError.invalidRequest(
          `Field "type" must be one of: ${SUPPORTED_DOCUMENT_TYPES.join(', ')}`,
        );
      }
      const subId = (req.body as Record<string, unknown>).sub_merchant_id;
      const doc = await uploadDocument({
        merchant_id: req.params.merchantId,
        sub_merchant_id: typeof subId === 'string' ? subId : undefined,
        type: type as DocumentType,
        original_name: file.originalname,
        content_type: file.mimetype,
        body: file.buffer,
      });
      res.status(201).json(
        success(shapeDocument(doc), { request_id: req.ogunContext.requestId }),
      );
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /v1/admin/merchants/:merchantId/submit — transitions the merchant to
 * `submitted` and runs the compliance pipeline. Mirrors the public route at
 * POST /v1/merchants/:id/submit.
 */
router.post('/admin/merchants/:merchantId/submit', async (req, res, next) => {
  try {
    requireAdmin(req);
    await transitionMerchant(req.params.merchantId, MerchantStatus.Submitted);
    const pipeline = await runCompliancePipeline(req.params.merchantId);
    res.status(202).json(
      success(
        {
          merchant_id: req.params.merchantId,
          status: pipeline.new_status,
          recommendation: pipeline.recommendation,
          flags: pipeline.flags,
        },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

const adminPatchMerchantBody = z
  .object({
    legal_name: z.string().min(2).optional(),
    trading_name: z.string().min(2).optional(),
    registration_number: z.string().optional(),
    tax_id: z.string().optional(),
    business_category: z.string().optional(),
    business_address: z.record(z.unknown()).optional(),
    website_url: z.string().url().optional(),
    expected_monthly_volume: z.number().int().nonnegative().optional(),
    expected_avg_ticket: z.number().int().nonnegative().optional(),
    contact_name: z.string().optional(),
    contact_email: z.string().email().optional(),
    contact_phone: z.string().optional(),
  })
  .strict();

/**
 * PATCH /v1/admin/merchants/:id — update whitelisted profile fields without
 * requiring a merchant secret key.
 */
router.patch('/admin/merchants/:id', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(adminPatchMerchantBody, req.body);
    const updated = await updateMerchantProfile(req.params.id, body);
    res.json(success(updated, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

const VALID_COLLECTION_METHODS = ['mpesa', 'airtel', 'till', 'card', 'bank'] as const;
const VALID_PAYOUT_METHODS = ['mpesa', 'airtel', 'bank'] as const;

const adminSettingsBody = z
  .object({
    collection_fee_pct: z.number().nonnegative().max(100).optional(),
    collection_fee_model: z.enum(['merchant_covers', 'payer_covers']).optional(),
    payout_fee_pct: z.number().nonnegative().max(100).optional(),
    payout_fee_model: z.enum(['merchant_covers', 'recipient_covers']).optional(),
    settlement_fee_pct: z.number().nonnegative().max(100).optional(),
    notification_emails: z.array(z.string().email()).optional(),
    enabled_methods: z.array(z.enum(VALID_COLLECTION_METHODS)).optional(),
    enabled_payout_methods: z.array(z.enum(VALID_PAYOUT_METHODS)).optional(),
    settlement_frequency: z.enum(['daily', 'weekly', 'bi-weekly', 'monthly']).optional(),
    webhook_url: z.string().url().startsWith('https://').max(2048).optional().nullable(),
  })
  .strict();

/**
 * PATCH /v1/admin/merchants/:id/settings — admin-side merchant settings upsert.
 */
router.patch('/admin/merchants/:id/settings', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(adminSettingsBody, req.body);
    await upsertSettings({
      id: newId('merchantSettings'),
      merchant_id: req.params.id,
      sub_merchant_id: null,
      ...body,
    });
    const effective = await resolveEffectiveSettings(req.params.id, null);
    res.json(success(effective, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

const adminCreateSubMerchantBody = z.object({
  merchant_id: z.string().startsWith('mrc_'),
  name: z.string().min(2),
  code: z.string().optional(),
  settlement_preference: z.enum(['daily', 'weekly', 'monthly', 'on_demand']).optional(),
  settlement_destination: z.record(z.unknown()).optional(),
  contact: z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })
    .optional(),
});

/**
 * GET /v1/admin/merchants/:id/settings — read effective settings.
 */
router.get('/admin/merchants/:id/settings', async (req, res, next) => {
  try {
    requireAdmin(req);
    const effective = await resolveEffectiveSettings(req.params.id, null);
    res.json(success(effective, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/admin/sub-merchants — create a sub-merchant on behalf of a merchant.
 */
router.post('/admin/sub-merchants', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(adminCreateSubMerchantBody, req.body);
    const sub = await createSubMerchant(body);
    res.status(201).json(
      success(
        { id: sub.id, merchant_id: sub.merchant_id, status: sub.status },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /v1/admin/sub-merchants/:id/settings — sub-merchant settings override.
 */
router.patch('/admin/sub-merchants/:id/settings', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(adminSettingsBody, req.body);
    // Look up the sub to find its merchant_id (settings rows need both).
    const { rows } = await query<{ merchant_id: string }>(
      `SELECT merchant_id FROM sub_merchants WHERE id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) {
      throw OgunError.notFound('SubMerchant', req.params.id);
    }
    await upsertSettings({
      id: newId('merchantSettings'),
      merchant_id: rows[0].merchant_id,
      sub_merchant_id: req.params.id,
      ...body,
    });
    const effective = await resolveEffectiveSettings(rows[0].merchant_id, req.params.id);
    res.json(success(effective, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

const listSettlementsQuery = pagination.extend({
  merchant_id: z.string().startsWith('mrc_').optional(),
  sub_merchant_id: z.string().startsWith('smrc_').optional(),
  status: z.string().optional(),
});

/**
 * GET /v1/admin/settlements — cross-merchant settlement inspector.
 * Mirrors the shape of `/admin/payouts` with bigint columns normalised to
 * numbers in the response.
 */
router.get('/admin/settlements', async (req, res, next) => {
  try {
    requireAdmin(req);
    const parsed = parseQuery(listSettlementsQuery, req.query);
    const { page, limit } = resolvePagination(parsed);
    const where: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (parsed.merchant_id) {
      where.push(`merchant_id = $${i++}`);
      vals.push(parsed.merchant_id);
    }
    if (parsed.sub_merchant_id) {
      where.push(`sub_merchant_id = $${i++}`);
      vals.push(parsed.sub_merchant_id);
    }
    if (parsed.status) {
      where.push(`status = $${i++}`);
      vals.push(parsed.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const [{ rows: items }, { rows: totals }] = await Promise.all([
      query(
        `SELECT id, merchant_id, sub_merchant_id, period_start, period_end,
                gross_amount, fee_amount, settlement_fee, refund_adjustment_amount,
                other_adjustment_amount, net_amount, transaction_count,
                status, payout_id, report_url, destination_summary, created_at, updated_at
           FROM settlements ${whereSql}
          ORDER BY created_at DESC
          LIMIT $${i++} OFFSET $${i++}`,
        [...vals, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT count(*)::text AS count FROM settlements ${whereSql}`,
        vals,
      ),
    ]);
    const normalized = items.map((s: Record<string, unknown>) => ({
      ...s,
      gross_amount: Number(s.gross_amount),
      fee_amount: Number(s.fee_amount),
      settlement_fee: Number(s.settlement_fee),
      refund_adjustment_amount: Number(s.refund_adjustment_amount),
      other_adjustment_amount: Number(s.other_adjustment_amount),
      net_amount: Number(s.net_amount),
    }));
    res.json(
      paginated(normalized, page, limit, Number(totals[0]?.count ?? 0), req.ogunContext.requestId),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Admin-mirror rotation endpoints. The merchant-auth versions live in
 * merchants.routes.ts; admins can target any merchant id by name.
 */
const adminRotateBody = z.object({
  environment: z.enum(['sandbox', 'live']).default('sandbox'),
});

router.post('/admin/merchants/:id/api-keys/rotate', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(adminRotateBody, req.body ?? {});
    const env = body.environment ?? 'sandbox';
    const secret = await rotateKey(req.params.id, 'secret', env);
    res.json(
      success(
        { key_type: 'secret', environment: env, secret_key: secret },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

router.post('/admin/merchants/:id/webhook-secret/rotate', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(adminRotateBody, req.body ?? {});
    const env = body.environment ?? 'sandbox';
    const secret = await rotateKey(req.params.id, 'webhook_secret', env);
    res.json(
      success(
        { key_type: 'webhook_secret', environment: env, webhook_secret: secret },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/admin/merchants/:id/credentials/masked — returns masked credential
 * values for display in the admin panel. Plaintext is never returned; only
 * masked_value (e.g., sk_live_••••1234) and the key_type + environment.
 */
router.get('/admin/merchants/:id/credentials/masked', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rows } = await query<{
      key_type: string;
      environment: string;
      masked_value: string;
      is_active: boolean;
      created_at: string;
      rotated_at: string | null;
    }>(
      `SELECT key_type, environment, masked_value, is_active, created_at, rotated_at
         FROM api_credentials
        WHERE merchant_id = $1 AND is_active = true
        ORDER BY environment, key_type`,
      [req.params.id],
    );
    res.json(success(rows, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/admin/merchants/:id/webhook-test — sends a test webhook event to
 * the merchant's configured webhook_url. Returns the HTTP status + body excerpt.
 */
router.post('/admin/merchants/:id/webhook-test', async (req, res, next) => {
  try {
    requireAdmin(req);
    const settings = await resolveEffectiveSettings(req.params.id, null);
    const url = settings.webhook_url;
    if (!url) {
      throw OgunError.invalidRequest('No webhook URL configured for this merchant.');
    }
    const payload = {
      type: 'ping',
      merchant_id: req.params.id,
      timestamp: new Date().toISOString(),
      test: true,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const bodyText = await resp.text().catch(() => '');
      res.json(
        success(
          {
            url,
            status: resp.status,
            ok: resp.ok,
            body_excerpt: bodyText.slice(0, 500),
          },
          { request_id: req.ogunContext.requestId },
        ),
      );
    } catch (fetchErr) {
      clearTimeout(timeout);
      const msg = fetchErr instanceof Error ? fetchErr.message : 'fetch failed';
      res.json(
        success(
          { url, status: 0, ok: false, body_excerpt: msg },
          { request_id: req.ogunContext.requestId },
        ),
      );
    }
  } catch (err) {
    next(err);
  }
});

export default router;
