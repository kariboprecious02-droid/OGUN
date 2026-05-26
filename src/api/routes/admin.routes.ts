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
import { logger } from '@/infra/logger';
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
import { query, withTransaction } from '@/infra/db/pool';
import { syncPayout } from '@/modules/payout/payout.service';
import { registerWebhookEndpoint, listWebhookEndpoints, syncWebhookEndpointFromUrl, removeWebhookEndpoints } from '@/modules/webhook/webhook.service';
import { generateApiKey } from '@/infra/crypto';
import { enforceRateLimit } from '@/infra/rateLimit';
import { postLedgerEntry } from '@/modules/wallet/ledger';
import { LedgerTxType } from '@/modules/wallet/wallet.types';
import { emitEvent } from '@/modules/webhook/webhook.service';

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
 * GET /v1/admin/wallets/:id — wallet detail with KPIs (lifetime funded,
 * lifetime disbursed, median disbursement).
 */
router.get('/admin/wallets/:id', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rows } = await query(
      `SELECT w.*, sm.name AS sub_merchant_name, m.legal_name AS merchant_legal_name
         FROM wallets w
         JOIN sub_merchants sm ON sm.id = w.sub_merchant_id
         JOIN merchants m ON m.id = w.merchant_id
        WHERE w.id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) throw OgunError.notFound('Wallet', req.params.id);
    const w = rows[0] as Record<string, unknown>;

    // KPIs: lifetime funded, lifetime disbursed, median disbursement
    const [{ rows: fundedRows }, { rows: disbursedRows }, { rows: medianRows }] = await Promise.all([
      query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM wallet_topups WHERE wallet_id = $1`,
        [req.params.id],
      ),
      query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM ledger_entries
          WHERE wallet_id = $1 AND transaction_type IN ('payout_principal_debit')`,
        [req.params.id],
      ),
      query<{ median: string | null }>(
        `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::text AS median
           FROM ledger_entries
          WHERE wallet_id = $1 AND transaction_type = 'payout_principal_debit'`,
        [req.params.id],
      ),
    ]);

    res.json(success({
      ...w,
      available_balance: Number(w.available_balance),
      reserved_balance: Number(w.reserved_balance),
      low_balance_threshold: Number(w.low_balance_threshold ?? 5000),
      lifetime_funded: Number(fundedRows[0]?.total ?? 0),
      lifetime_disbursed: Number(disbursedRows[0]?.total ?? 0),
      median_disbursement: medianRows[0]?.median ? Number(medianRows[0].median) : null,
    }, { request_id: req.ogunContext.requestId }));
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
 * GET /v1/admin/wallets/:id/topups — paginated funding history for a wallet.
 */
router.get('/admin/wallets/:id/topups', async (req, res, next) => {
  try {
    requireAdmin(req);
    const parsed = parseQuery(pagination, req.query);
    const { page, limit } = resolvePagination(parsed);
    const offset = (page - 1) * limit;
    const [{ rows: items }, { rows: totals }] = await Promise.all([
      query(
        `SELECT * FROM wallet_topups WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [req.params.id, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT count(*)::text AS count FROM wallet_topups WHERE wallet_id = $1`,
        [req.params.id],
      ),
    ]);
    const normalized = items.map((t: Record<string, unknown>) => ({
      ...t,
      amount: Number(t.amount),
      fee_amount: Number(t.fee_amount),
    }));
    res.json(paginated(normalized, page, limit, Number(totals[0]?.count ?? 0), req.ogunContext.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/admin/wallet-topups — admin-initiated wallet funding.
 *
 * Validates input, checks freeze status, inserts a wallet_topup record,
 * posts a wallet_topup_credit ledger entry (idempotent on source_reference),
 * updates wallet metadata, and emits a wallet.topup.settled webhook event.
 */
const topupBody = z.object({
  wallet_id: z.string().startsWith('wal_'),
  amount: z.number().int().positive(),
  currency: z.literal('KES'),
  source: z.enum(['bank_transfer', 'paybill_transfer']),
  source_reference: z.string().max(200).nullable().optional(),
  reason: z.string().min(3).max(500),
});

router.post('/admin/wallet-topups', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(topupBody, req.body);

    // Look up wallet
    const { rows: walletRows } = await query(
      `SELECT w.*, m.legal_name AS merchant_legal_name, sm.name AS sub_merchant_name
         FROM wallets w
         JOIN merchants m ON m.id = w.merchant_id
         JOIN sub_merchants sm ON sm.id = w.sub_merchant_id
        WHERE w.id = $1`,
      [body.wallet_id],
    );
    if (walletRows.length === 0) throw OgunError.notFound('Wallet', body.wallet_id);
    const wallet = walletRows[0] as Record<string, unknown>;

    if (wallet.is_frozen) {
      throw new OgunError('invalid_request', 'Wallet is frozen. Unfreeze it before funding.', { wallet_id: body.wallet_id }, 422);
    }

    const topupId = newId('walletTopup');
    const sourceRef = body.source_reference ?? `topup_${topupId}`;
    const adminEmail = (req as any).ogunContext?.adminEmail ?? 'admin@ogun-pay.io';

    await withTransaction(async (client) => {
      // Insert topup record (idempotent on source_reference)
      const insertResult = await client.query(
        `INSERT INTO wallet_topups (id, wallet_id, merchant_id, sub_merchant_id, amount, currency, source, source_reference, reason, initiated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (source_reference) DO NOTHING`,
        [topupId, body.wallet_id, wallet.merchant_id, wallet.sub_merchant_id, body.amount, body.currency, body.source, sourceRef, body.reason, adminEmail],
      );

      if (insertResult.rowCount === 0) {
        // Duplicate — skip ledger + metadata update
        return;
      }

      // Post ledger entry
      await postLedgerEntry(client, {
        merchantId: wallet.merchant_id as string,
        subMerchantId: wallet.sub_merchant_id as string,
        walletId: body.wallet_id,
        walletType: wallet.wallet_type as 'collection' | 'payout',
        transactionType: LedgerTxType.WalletTopupCredit,
        direction: 'credit',
        amount: body.amount,
        currency: body.currency,
        referenceType: 'topup',
        referenceId: topupId,
        idempotencyKey: `wallet_topup_credit:${sourceRef}`,
        description: `Admin wallet funding: ${body.reason}`,
      });

      // Update wallet metadata
      await client.query(
        `UPDATE wallets SET last_funded_at = now(), last_funded_by = $2, updated_at = now() WHERE id = $1`,
        [body.wallet_id, adminEmail],
      );
    });

    // Fetch the topup row (may be the existing one if duplicate)
    const { rows: topupRows } = await query(
      `SELECT * FROM wallet_topups WHERE source_reference = $1`,
      [sourceRef],
    );
    const topup = topupRows[0] as Record<string, unknown>;

    // Emit webhook (fire-and-forget)
    emitEvent({
      merchantId: wallet.merchant_id as string,
      type: 'wallet.topup.settled',
      data: {
        topup_id: topup.id,
        wallet_id: body.wallet_id,
        amount: body.amount,
        currency: body.currency,
        source: body.source,
        source_reference: sourceRef,
      },
    }).catch((err) => logger.error({ err }, 'failed to emit wallet.topup.settled'));

    res.status(201).json(success({
      topup_id: topup.id,
      wallet_id: body.wallet_id,
      amount: Number(topup.amount),
      fee_amount: Number(topup.fee_amount ?? 0),
      source: topup.source,
      source_reference: topup.source_reference,
      initiated_by: topup.initiated_by,
      status: topup.status,
      created_at: topup.created_at,
    }, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/admin/wallets/:id/freeze — freeze a wallet, blocking topups
 * and disbursements until unfrozen.
 */
router.post('/admin/wallets/:id/freeze', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { reason } = req.body as { reason?: string };
    const adminEmail = (req as any).ogunContext?.adminEmail ?? 'admin@ogun-pay.io';
    const { rowCount } = await query(
      `UPDATE wallets SET is_frozen = true, freeze_reason = $2, frozen_by = $3, frozen_at = now(), updated_at = now()
        WHERE id = $1 AND is_frozen = false`,
      [req.params.id, reason ?? 'Admin freeze', adminEmail],
    );
    if (rowCount === 0) {
      const { rows } = await query(`SELECT id, is_frozen FROM wallets WHERE id = $1`, [req.params.id]);
      if (rows.length === 0) throw OgunError.notFound('Wallet', req.params.id);
      // Already frozen — return current state
    }
    const { rows } = await query(`SELECT * FROM wallets WHERE id = $1`, [req.params.id]);
    res.json(success(rows[0], { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/admin/wallets/:id/unfreeze — unfreeze a previously frozen wallet.
 */
router.post('/admin/wallets/:id/unfreeze', async (req, res, next) => {
  try {
    requireAdmin(req);
    await query(
      `UPDATE wallets SET is_frozen = false, freeze_reason = null, frozen_by = null, frozen_at = null, updated_at = now()
        WHERE id = $1`,
      [req.params.id],
    );
    const { rows } = await query(`SELECT * FROM wallets WHERE id = $1`, [req.params.id]);
    if (rows.length === 0) throw OgunError.notFound('Wallet', req.params.id);
    res.json(success(rows[0], { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /v1/admin/wallets/:id/threshold — update the low-balance alert
 * threshold (in cents).
 */
router.patch('/admin/wallets/:id/threshold', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { threshold } = req.body as { threshold: number };
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw OgunError.invalidRequest('threshold must be a non-negative integer (cents)');
    }
    await query(
      `UPDATE wallets SET low_balance_threshold = $2, updated_at = now() WHERE id = $1`,
      [req.params.id, threshold],
    );
    const { rows } = await query(`SELECT * FROM wallets WHERE id = $1`, [req.params.id]);
    if (rows.length === 0) throw OgunError.notFound('Wallet', req.params.id);
    res.json(success(rows[0], { request_id: req.ogunContext.requestId }));
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
        `SELECT c.id, c.merchant_id, c.sub_merchant_id, c.amount, c.fee_amount, c.currency,
                c.method, c.provider, c.business_status, c.internal_status, c.status_reason,
                c.customer_phone, c.merchant_reference, c.settlement_eligible,
                c.wallet_credited, c.refund_status, c.created_at, c.final_resolved_at,
                sm.name AS sub_merchant_name
           FROM collections c
           LEFT JOIN sub_merchants sm ON sm.id = c.sub_merchant_id
           ${whereSql ? whereSql.replace(/\b(merchant_id|sub_merchant_id|business_status)\b/g, 'c.$1') : ''}
          ORDER BY c.created_at DESC
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

router.get('/admin/collections/:id', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rows } = await query(
      `SELECT c.*, sm.name AS sub_merchant_name
         FROM collections c
         LEFT JOIN sub_merchants sm ON sm.id = c.sub_merchant_id
        WHERE c.id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) {
      throw OgunError.notFound('Collection', req.params.id);
    }
    const c = rows[0] as Record<string, unknown>;
    res.json(success({
      ...c,
      amount: Number(c.amount),
      fee_amount: Number(c.fee_amount),
      customer_amount: Number(c.customer_amount),
      refunded_amount: c.refunded_amount != null ? Number(c.refunded_amount) : null,
      poll_attempt_count: Number(c.poll_attempt_count ?? 0),
    }, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/collections/:id/logs', async (req, res, next) => {
  try {
    requireAdmin(req);
    const [{ rows: events }, { rows: webhookEvents }, { rows: webhookDeliveries }] = await Promise.all([
      query(
        `SELECT id, event_type, source, http_status, latency_ms, payload, message, occurred_at
           FROM collection_events WHERE collection_id = $1 ORDER BY occurred_at`,
        [req.params.id],
      ),
      query(
        `SELECT id, event_type, raw_payload, signature_valid, http_status_returned, received_at
           FROM paystack_webhook_events WHERE collection_id = $1 ORDER BY received_at`,
        [req.params.id],
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT wd.id, wd.event_type, wd.payload, wd.delivery_status, wd.http_status,
                wd.response_body, wd.created_at, wd.delivered_at, wd.retry_count, we.url
           FROM webhook_deliveries wd
           JOIN webhook_endpoints we ON we.id = wd.endpoint_id
          WHERE wd.payload->>'collection_id' = $1
          ORDER BY wd.created_at`,
        [req.params.id],
      ).catch(() => ({ rows: [] })),
    ]);
    res.json(success({ events, webhookEvents, webhookDeliveries }, { request_id: req.ogunContext.requestId }));
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
  status: z.string().optional(),
  method: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  beneficiary_query: z.string().optional(),
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
      where.push(`p.merchant_id = $${i++}`);
      vals.push(parsed.merchant_id);
    }
    if (parsed.sub_merchant_id) {
      where.push(`p.sub_merchant_id = $${i++}`);
      vals.push(parsed.sub_merchant_id);
    }
    if (parsed.status) {
      const statuses = parsed.status.split(',').filter(Boolean);
      if (statuses.length === 1) {
        where.push(`p.status = $${i++}`);
        vals.push(statuses[0]);
      } else if (statuses.length > 1) {
        const placeholders = statuses.map(() => `$${i++}`).join(',');
        where.push(`p.status IN (${placeholders})`);
        vals.push(...statuses);
      }
    }
    if (parsed.method) {
      where.push(`p.method = $${i++}`);
      vals.push(parsed.method);
    }
    if (parsed.from) {
      where.push(`p.created_at >= $${i++}`);
      vals.push(parsed.from);
    }
    if (parsed.to) {
      where.push(`p.created_at <= $${i++}`);
      vals.push(parsed.to);
    }
    if (parsed.beneficiary_query) {
      where.push(`b.name ILIKE '%' || $${i++} || '%'`);
      vals.push(parsed.beneficiary_query);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    const [{ rows: items }, { rows: totals }] = await Promise.all([
      query(
        `SELECT p.id, p.merchant_id, p.sub_merchant_id, p.beneficiary_id, p.amount, p.fee_amount, p.total_debit,
                p.recipient_amount, p.fee_model, p.currency, p.method, p.provider, p.status,
                p.provider_reference, p.provider_status, p.provider_transfer_code,
                p.failure_reason, p.reversal_indicator, p.external_reference AS reference,
                p.created_at, p.final_resolved_at,
                b.name AS beneficiary_name
           FROM payouts p
           LEFT JOIN beneficiaries b ON b.id = p.beneficiary_id
           ${whereSql}
          ORDER BY p.created_at DESC
          LIMIT $${i++} OFFSET $${i++}`,
        [...vals, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT count(*)::text AS count FROM payouts p LEFT JOIN beneficiaries b ON b.id = p.beneficiary_id ${whereSql}`,
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

router.get('/admin/payouts/:id', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rows } = await query(
      `SELECT p.*, b.name AS beneficiary_name, b.beneficiary_type, b.mobile_number,
              b.bank_code, b.account_number AS beneficiary_account_number,
              b.provider_recipient_code
         FROM payouts p
         LEFT JOIN beneficiaries b ON b.id = p.beneficiary_id
        WHERE p.id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) throw OgunError.notFound('Payout', req.params.id);
    const p = rows[0] as Record<string, unknown>;
    res.json(success({
      ...p,
      amount: Number(p.amount),
      fee_amount: Number(p.fee_amount),
      total_debit: Number(p.total_debit),
      recipient_amount: Number(p.recipient_amount),
      wallet_reserved_amount: p.wallet_reserved_amount != null ? Number(p.wallet_reserved_amount) : null,
    }, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/payouts/:id/logs', async (req, res, next) => {
  try {
    requireAdmin(req);
    const payoutId = req.params.id;

    // Get the payout first for provider_reference and provider_transfer_code
    const { rows: payoutRows } = await query(
      `SELECT provider_reference, provider_transfer_code FROM payouts WHERE id = $1`,
      [payoutId],
    );
    if (payoutRows.length === 0) throw OgunError.notFound('Payout', payoutId);
    const payout = payoutRows[0] as { provider_reference: string | null; provider_transfer_code: string | null };

    // 1. Lifecycle events — from payout_events table (doesn't exist yet, graceful fallback)
    let lifecycle: unknown[] = [];
    try {
      const { rows } = await query(
        `SELECT * FROM payout_events WHERE payout_id = $1 ORDER BY occurred_at ASC`,
        [payoutId],
      );
      lifecycle = rows;
    } catch {
      // Table doesn't exist yet (Task 3 item #5)
    }

    // 2. Inbound Paystack webhooks — transfer.* events matching this payout
    const webhookWhere: string[] = [`event_type LIKE 'transfer.%'`];
    const webhookVals: unknown[] = [];
    let wi = 1;
    const orClauses: string[] = [];
    if (payout.provider_reference) {
      orClauses.push(`raw_payload->'data'->>'reference' = $${wi}`);
      // Also try matching on the reference field directly
      orClauses.push(`raw_payload::text ILIKE '%' || $${wi} || '%'`);
      webhookVals.push(payout.provider_reference);
      wi++;
    }
    if (payout.provider_transfer_code) {
      orClauses.push(`raw_payload::text ILIKE '%' || $${wi} || '%'`);
      webhookVals.push(payout.provider_transfer_code);
      wi++;
    }

    let paystack_inbound: unknown[] = [];
    if (orClauses.length > 0) {
      try {
        webhookWhere.push(`(${orClauses.join(' OR ')})`);
        const { rows } = await query(
          `SELECT id, event_type, raw_payload, signature_valid, http_status_returned, received_at
             FROM paystack_webhook_events
            WHERE ${webhookWhere.join(' AND ')}
            ORDER BY received_at ASC
            LIMIT 50`,
          webhookVals,
        );
        paystack_inbound = rows;
      } catch (err) {
        logger.error({ err, payout_id: payoutId }, 'failed to query paystack_webhook_events for payout logs');
      }
    }

    // 3. Outbound merchant webhook deliveries
    let webhook_deliveries: unknown[] = [];
    try {
      const { rows: deliveries } = await query(
        `SELECT wd.id, wd.event_type, wd.payload, wd.delivery_status, wd.http_status,
                wd.last_error AS response_body, wd.created_at, wd.last_attempt_at AS delivered_at,
                wd.attempt_count AS retry_count,
                we.url
           FROM webhook_deliveries wd
           LEFT JOIN webhook_endpoints we ON we.id = wd.webhook_endpoint_id
          WHERE wd.event_type LIKE 'payout.%'
            AND wd.merchant_id = (SELECT merchant_id FROM payouts WHERE id = $1)
          ORDER BY wd.created_at ASC
          LIMIT 50`,
        [payoutId],
      );
      webhook_deliveries = deliveries;
    } catch (err) {
      logger.error({ err, payout_id: payoutId }, 'failed to query webhook_deliveries for payout logs');
    }

    res.json(success({
      lifecycle,
      paystack_inbound,
      webhook_deliveries,
    }, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.post('/admin/payouts/:id/sync', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rows } = await query(`SELECT id, status FROM payouts WHERE id = $1`, [req.params.id]);
    if (rows.length === 0) throw OgunError.notFound('Payout', req.params.id);
    const existing = rows[0] as { id: string; status: string };

    const terminal = ['succeeded', 'failed', 'reversed', 'cancelled'];
    if (terminal.includes(existing.status)) {
      res.json(success({
        payout_id: existing.id,
        status: existing.status,
        message: 'Payout is already terminal',
      }, { request_id: req.ogunContext.requestId }));
      return;
    }

    await enforceRateLimit(`payout_sync:${existing.id}`, 60, 1);
    const p = await syncPayout(existing.id);
    res.json(success({
      payout_id: p.id,
      status: p.status,
      provider_status: p.provider_status,
      last_polled_at: new Date().toISOString(),
    }, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/beneficiaries', async (req, res, next) => {
  try {
    requireAdmin(req);
    const merchantId = req.query.merchant_id as string | undefined;
    const where = merchantId ? `WHERE merchant_id = $1` : '';
    const vals = merchantId ? [merchantId] : [];
    const { rows } = await query(
      `SELECT * FROM beneficiaries ${where} ORDER BY created_at DESC LIMIT 100`,
      vals,
    );
    res.json(success(rows, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/beneficiaries/:id', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rows } = await query(`SELECT * FROM beneficiaries WHERE id = $1`, [req.params.id]);
    if (rows.length === 0) throw OgunError.notFound('Beneficiary', req.params.id);
    res.json(success(rows[0], { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/merchants/:id/webhook-endpoints', async (req, res, next) => {
  try {
    requireAdmin(req);
    const endpoints = await listWebhookEndpoints(req.params.id);
    res.json(success(endpoints, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.post('/admin/merchants/:id/webhook-endpoints', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { url, subscribed_events } = req.body as { url: string; subscribed_events?: string[] };
    if (!url) throw OgunError.invalidRequest('url is required');
    const secret = generateApiKey('whsec', 'test');
    const result = await registerWebhookEndpoint({
      merchant_id: req.params.id,
      url,
      webhookSecret: secret,
      subscribed_events: subscribed_events ?? [],
    });
    res.status(201).json(success({
      id: result.id,
      url,
      webhook_secret: secret,
      subscribed_events: subscribed_events ?? [],
    }, { request_id: req.ogunContext.requestId }));
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
    settlement_bank_name: z.string().max(200).optional().nullable(),
    settlement_account_number: z.string().max(50).optional().nullable(),
    settlement_branch_code: z.string().max(50).optional().nullable(),
    settlement_account_holder: z.string().max(200).optional().nullable(),
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
    if (body.webhook_url !== undefined) {
      if (body.webhook_url) {
        await syncWebhookEndpointFromUrl(req.params.id, body.webhook_url);
      } else {
        await removeWebhookEndpoints(req.params.id);
      }
    }
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
        `SELECT s.id, s.merchant_id, s.sub_merchant_id, s.period_start, s.period_end,
                s.gross_amount, s.fee_amount, s.settlement_fee, s.refund_adjustment_amount,
                s.other_adjustment_amount, s.net_amount, s.transaction_count,
                s.status, s.payout_id, s.report_url, s.destination_summary, s.created_at, s.updated_at,
                sm.name AS sub_merchant_name
           FROM settlements s
           LEFT JOIN sub_merchants sm ON sm.id = s.sub_merchant_id
           ${whereSql ? whereSql.replace(/\b(merchant_id|sub_merchant_id|status)\b/g, 's.$1') : ''}
          ORDER BY s.created_at DESC
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

router.get('/admin/settlements/:id', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rows: settlements } = await query(
      `SELECT s.*, sm.name AS sub_merchant_name
         FROM settlements s
         LEFT JOIN sub_merchants sm ON sm.id = s.sub_merchant_id
        WHERE s.id = $1`,
      [req.params.id],
    );
    if (settlements.length === 0) {
      throw OgunError.notFound('Settlement', req.params.id);
    }
    const s = settlements[0] as Record<string, unknown>;
    const { rows: lineItems } = await query(
      `SELECT sli.*, c.method, c.customer_phone, c.business_status, c.merchant_reference
         FROM settlement_line_items sli
         LEFT JOIN collections c ON c.id = sli.reference_id
        WHERE sli.settlement_id = $1
        ORDER BY sli.id`,
      [req.params.id],
    );
    res.json(success({
      ...s,
      gross_amount: Number(s.gross_amount),
      fee_amount: Number(s.fee_amount),
      settlement_fee: Number(s.settlement_fee),
      refund_adjustment_amount: Number(s.refund_adjustment_amount),
      other_adjustment_amount: Number(s.other_adjustment_amount),
      net_amount: Number(s.net_amount),
      line_items: lineItems.map((li: Record<string, unknown>) => ({
        ...li,
        amount: Number(li.amount),
      })),
    }, { request_id: req.ogunContext.requestId }));
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

router.get('/admin/banks/kenya', async (req, res, next) => {
  try {
    requireAdmin(req);
    const { fetchPaystackBanks } = await import('@/modules/connectors/paystackBanks');
    const banks = await fetchPaystackBanks();
    res.json(success(banks, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
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
