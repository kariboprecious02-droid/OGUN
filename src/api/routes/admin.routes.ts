/**
 * Admin routes — these are gated behind an out-of-band admin auth
 * mechanism (session-based in the dashboard).  In MVP we gate them by
 * a shared admin secret header.
 */
import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '@/api/validation';
import { success } from '@/infra/response';
import { OgunError } from '@/infra/errors';
import { submitManualDecision } from '@/modules/compliance/compliance.service';
import { activateMerchant, suspendMerchant } from '@/modules/merchant/merchant.service';
import { issueCredentials } from '@/modules/auth/auth.service';
import { config } from '@/infra/config';

const router = Router();

function requireAdmin(req: import('express').Request): void {
  const header = req.header('X-Ogun-Admin-Secret');
  if (!header || header !== config.platform.webhookSigningSalt) {
    throw OgunError.forbidden('Admin authentication required');
  }
}

const reviewBody = z.object({
  decision: z.enum(['approve', 'changes_requested', 'reject']),
  notes: z.string().max(2000),
  actor_id: z.string().optional(),
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

export default router;
