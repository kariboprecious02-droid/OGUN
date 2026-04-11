import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '@/api/validation';
import { idempotency } from '@/api/middleware/idempotency';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { success } from '@/infra/response';
import { OgunError } from '@/infra/errors';
import { newId } from '@/infra/ids';
import {
  createMerchant,
  getMerchant,
  createSubMerchant,
  getSubMerchant,
  listSubMerchants,
  transitionMerchant,
  updateMerchantProfile,
  updateSubMerchantProfile,
} from '@/modules/merchant/merchant.service';
import { MerchantStatus } from '@/modules/merchant/merchant.types';
import { runCompliancePipeline } from '@/modules/compliance/compliance.service';
import { upsertSettings, resolveEffectiveSettings } from '@/modules/merchant/settings.repository';
import { rotateKey } from '@/modules/auth/auth.service';

const router = Router();

const createMerchantBody = z.object({
  legal_name: z.string().min(2),
  trading_name: z.string().min(2),
  registration_number: z.string().optional(),
  tax_id: z.string().optional(),
  country: z.string().length(2).optional(),
  settlement_currency: z.string().length(3).optional(),
  business_category: z.string().optional(),
  business_address: z.record(z.unknown()).optional(),
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

router.post('/merchants', authenticate(), idempotency('POST /merchants'), async (req, res, next) => {
  try {
    requireSecretKey(req);
    const body = parseBody(createMerchantBody, req.body);
    const merchant = await createMerchant(body);
    res.status(201).json(
      success(
        { id: merchant.id, status: merchant.status },
        { request_id: req.ogunContext.requestId, idempotency_key: req.ogunContext.idempotencyKey },
      ),
    );
  } catch (err) {
    next(err);
  }
});

router.get('/merchants/:id', authenticate(), async (req, res, next) => {
  try {
    const merchant = await getMerchant(req.params.id);
    res.json(success(merchant, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.post('/merchants/:id/submit', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    await transitionMerchant(req.params.id, MerchantStatus.Submitted);
    const pipeline = await runCompliancePipeline(req.params.id);
    res.status(202).json(
      success(
        { merchant_id: req.params.id, status: pipeline.new_status, recommendation: pipeline.recommendation, flags: pipeline.flags },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

const createSubMerchantBody = z.object({
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

router.post('/sub-merchants', authenticate(), idempotency('POST /sub-merchants'), async (req, res, next) => {
  try {
    requireSecretKey(req);
    const body = parseBody(createSubMerchantBody, req.body);
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

router.get('/sub-merchants/:id', authenticate(), async (req, res, next) => {
  try {
    const sub = await getSubMerchant(req.params.id);
    res.json(success(sub, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.get('/sub-merchants', authenticate(), async (req, res, next) => {
  try {
    const merchantId = req.ogunContext.principal!.merchantId;
    const subs = await listSubMerchants(merchantId);
    res.json(success(subs, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /v1/merchants/:id — update whitelisted profile fields (§12.1).
 * Ownership guard: only the merchant itself can patch.
 */
const patchMerchantBody = z
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

router.patch('/merchants/:id', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    if (req.params.id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('Merchant', req.params.id);
    }
    const body = parseBody(patchMerchantBody, req.body);
    const updated = await updateMerchantProfile(req.params.id, body);
    res.json(success(updated, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

const patchSubMerchantBody = z
  .object({
    name: z.string().min(2).optional(),
    code: z.string().optional(),
    settlement_preference: z.enum(['daily', 'weekly', 'monthly', 'on_demand']).optional(),
    settlement_destination: z.record(z.unknown()).optional(),
    contact_name: z.string().optional(),
    contact_email: z.string().email().optional(),
    contact_phone: z.string().optional(),
  })
  .strict();

router.patch('/sub-merchants/:id', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    const sub = await getSubMerchant(req.params.id);
    if (sub.merchant_id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('SubMerchant', req.params.id);
    }
    const body = parseBody(patchSubMerchantBody, req.body);
    const updated = await updateSubMerchantProfile(req.params.id, body);
    res.json(success(updated, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/**
 * Merchant + sub-merchant settings (§3.3 / §12.5).
 *
 * Settings are stored per merchant with optional per-sub-merchant
 * override. Effective settings inherit from the merchant row when no
 * sub-merchant override exists.
 *
 *   PATCH /v1/merchants/:id/settings               — merchant-level
 *   PATCH /v1/sub-merchants/:id/settings            — sub-merchant override
 *   GET   /v1/merchants/:id/settings                — effective settings
 */
const settingsBody = z
  .object({
    collection_fee_pct: z.number().nonnegative().optional(),
    collection_fee_model: z.enum(['merchant_covers', 'payer_covers']).optional(),
    payout_fee_pct: z.number().nonnegative().optional(),
    payout_fee_model: z.enum(['merchant_covers', 'recipient_covers']).optional(),
    settlement_fee_pct: z.number().nonnegative().optional(),
    notification_emails: z.array(z.string().email()).optional(),
    enabled_methods: z.array(z.string()).optional(),
  })
  .strict();

router.patch('/merchants/:id/settings', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    if (req.params.id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('Merchant', req.params.id);
    }
    const body = parseBody(settingsBody, req.body);
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

router.get('/merchants/:id/settings', authenticate(), async (req, res, next) => {
  try {
    if (req.params.id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('Merchant', req.params.id);
    }
    const effective = await resolveEffectiveSettings(req.params.id, null);
    res.json(success(effective, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.patch('/sub-merchants/:id/settings', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    const sub = await getSubMerchant(req.params.id);
    if (sub.merchant_id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('SubMerchant', req.params.id);
    }
    const body = parseBody(settingsBody, req.body);
    await upsertSettings({
      id: newId('merchantSettings'),
      merchant_id: sub.merchant_id,
      sub_merchant_id: sub.id,
      ...body,
    });
    const effective = await resolveEffectiveSettings(sub.merchant_id, sub.id);
    res.json(success(effective, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/**
 * Credential rotation — §12.2.
 * Rotating a key immediately deactivates the previous credential.
 */
const rotateBody = z.object({
  environment: z.enum(['sandbox', 'live']).default('sandbox'),
});

router.post('/merchants/:id/api-keys/rotate', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    if (req.params.id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('Merchant', req.params.id);
    }
    const body = parseBody(rotateBody, req.body ?? {});
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

router.post('/merchants/:id/webhook-secret/rotate', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    if (req.params.id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('Merchant', req.params.id);
    }
    const body = parseBody(rotateBody, req.body ?? {});
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

export default router;
