import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '@/api/validation';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { idempotency } from '@/api/middleware/idempotency';
import { success } from '@/infra/response';
import { createSettlement, executeSettlement } from '@/modules/settlement/settlement.service';
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
    const { rows } = await query(
      `SELECT * FROM settlements WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) throw OgunError.notFound('Settlement', req.params.id);
    res.json(success(rows[0], { request_id: req.ogunContext.requestId }));
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
