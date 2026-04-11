import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '@/api/validation';
import { idempotency } from '@/api/middleware/idempotency';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { success } from '@/infra/response';
import {
  createMerchant,
  getMerchant,
  createSubMerchant,
  getSubMerchant,
  listSubMerchants,
  transitionMerchant,
} from '@/modules/merchant/merchant.service';
import { MerchantStatus } from '@/modules/merchant/merchant.types';
import { runCompliancePipeline } from '@/modules/compliance/compliance.service';

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

export default router;
