import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '@/api/validation';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { idempotency } from '@/api/middleware/idempotency';
import { success } from '@/infra/response';
import { createSettlement, executeSettlement } from '@/modules/settlement/settlement.service';
import { getReportUrl } from '@/modules/settlement/report';
import { query } from '@/infra/db/pool';
import { OgunError } from '@/infra/errors';

const router = Router();

const createBody = z.object({
  merchant_id: z.string().startsWith('mrc_'),
  sub_merchant_id: z.string().startsWith('smrc_'),
  mode: z.enum(['on_demand', 'scheduled']).default('on_demand'),
});

router.post(
  '/settlements',
  authenticate(),
  idempotency('POST /settlements', { required: true }),
  async (req, res, next) => {
    try {
      requireSecretKey(req);
      const body = parseBody(createBody, req.body);
      if (body.merchant_id !== req.ogunContext.principal!.merchantId) {
        throw OgunError.forbidden('merchant_id does not match credentials');
      }
      const settlement = await createSettlement({
        merchantId: body.merchant_id,
        subMerchantId: body.sub_merchant_id,
      });
      const status = await executeSettlement(settlement.settlement_id);
      res.status(201).json(
        success(
          {
            id: settlement.settlement_id,
            gross: settlement.gross,
            fees: settlement.fees,
            settlement_fee: settlement.settlement_fee,
            refund_adjustments: settlement.refund_adjustments,
            net: settlement.net,
            transaction_count: settlement.transaction_count,
            status,
          },
          {
            request_id: req.ogunContext.requestId,
            idempotency_key: req.ogunContext.idempotencyKey,
          },
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get('/settlements/:id', authenticate(), async (req, res, next) => {
  try {
    const { rows } = await query<{ merchant_id: string }>(
      `SELECT * FROM settlements WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) throw OgunError.notFound('Settlement', req.params.id);
    if (rows[0].merchant_id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('Settlement', req.params.id);
    }
    res.json(success(rows[0], { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/settlements/:id/report — returns the persisted report URL
 * (§12.5). Presigns on demand for S3-backed storage; for the local
 * adapter the URL is just a `file://` path that ops can fetch.
 */
router.get('/settlements/:id/report', authenticate(), async (req, res, next) => {
  try {
    const { rows } = await query<{ merchant_id: string }>(
      `SELECT merchant_id FROM settlements WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) throw OgunError.notFound('Settlement', req.params.id);
    if (rows[0].merchant_id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('Settlement', req.params.id);
    }
    const url = await getReportUrl(req.params.id);
    if (!url) {
      throw OgunError.notFound('Settlement report', req.params.id);
    }
    // 15-minute "expiry" window surfaced in the response for API symmetry
    // with real S3 presigned URLs.
    res.json(
      success(
        { report_url: url, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

router.get('/settlements', authenticate(), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM settlements WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.ogunContext.principal!.merchantId],
    );
    res.json(success(rows, { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

export default router;
