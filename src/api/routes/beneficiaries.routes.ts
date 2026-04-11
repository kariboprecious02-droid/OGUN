import { Router } from 'express';
import { z } from 'zod';
import { parseBody, parseQuery, pagination, resolvePagination } from '@/api/validation';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { idempotency } from '@/api/middleware/idempotency';
import { success, paginated } from '@/infra/response';
import {
  createBeneficiary,
  getBeneficiary,
  listBeneficiaries,
  updateBeneficiary,
  deleteBeneficiary,
} from '@/modules/payout/beneficiary.service';

const router = Router();

const createBody = z.object({
  merchant_id: z.string().startsWith('mrc_'),
  sub_merchant_id: z.string().startsWith('smrc_'),
  name: z.string().min(2).max(255),
  beneficiary_type: z.enum(['mobile_money', 'bank_account']),
  mobile_number: z.string().optional(),
  bank_code: z.string().optional(),
  account_number: z.string().optional(),
  currency: z.string().length(3).optional(),
  provider: z.enum(['paystack', 'demo']).optional(),
});

function shape(b: Awaited<ReturnType<typeof getBeneficiary>>) {
  return {
    id: b.id,
    merchant_id: b.merchant_id,
    sub_merchant_id: b.sub_merchant_id,
    name: b.name,
    beneficiary_type: b.beneficiary_type,
    provider: b.provider,
    provider_recipient_code: b.provider_recipient_code,
    mobile_number: b.mobile_number,
    bank_code: b.bank_code,
    account_number: b.account_number,
    currency: b.currency,
    verification_status: b.verification_status,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

router.post(
  '/beneficiaries',
  authenticate(),
  idempotency('POST /beneficiaries'),
  async (req, res, next) => {
    try {
      requireSecretKey(req);
      const body = parseBody(createBody, req.body);
      if (body.merchant_id !== req.ogunContext.principal!.merchantId) {
        throw new Error('merchant_id does not match credentials');
      }
      const b = await createBeneficiary(body);
      res.status(201).json(
        success(shape(b), {
          request_id: req.ogunContext.requestId,
          idempotency_key: req.ogunContext.idempotencyKey,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

const listQuery = pagination.extend({
  sub_merchant_id: z.string().startsWith('smrc_').optional(),
});

router.get('/beneficiaries', authenticate(), async (req, res, next) => {
  try {
    const parsed = parseQuery(listQuery, req.query);
    const { page, limit } = resolvePagination(parsed);
    const result = await listBeneficiaries({
      merchant_id: req.ogunContext.principal!.merchantId,
      sub_merchant_id: parsed.sub_merchant_id,
      page,
      limit,
    });
    res.json(
      paginated(result.items.map(shape), page, limit, result.total, req.ogunContext.requestId),
    );
  } catch (err) {
    next(err);
  }
});

router.get('/beneficiaries/:id', authenticate(), async (req, res, next) => {
  try {
    const b = await getBeneficiary(
      req.ogunContext.principal!.merchantId,
      req.params.id,
    );
    res.json(success(shape(b), { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

const patchBody = z.object({
  name: z.string().min(2).max(255).optional(),
  mobile_number: z.string().nullable().optional(),
  bank_code: z.string().nullable().optional(),
  account_number: z.string().nullable().optional(),
  provider_recipient_code: z.string().nullable().optional(),
});

router.patch('/beneficiaries/:id', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    const body = parseBody(patchBody, req.body);
    const b = await updateBeneficiary(
      req.ogunContext.principal!.merchantId,
      req.params.id,
      body,
    );
    res.json(success(shape(b), { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.delete('/beneficiaries/:id', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    await deleteBeneficiary(
      req.ogunContext.principal!.merchantId,
      req.params.id,
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
