import { Router } from 'express';
import { z } from 'zod';
import { parseBody, parseQuery, pagination, resolvePagination } from '@/api/validation';
import { idempotency } from '@/api/middleware/idempotency';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { success, paginated } from '@/infra/response';
import {
  createPayout,
  getPayout,
  listPayouts,
} from '@/modules/payout/payout.service';
import { PayoutStatus } from '@/modules/payout/payout.types';

const router = Router();

const createBody = z.object({
  merchant_id: z.string().startsWith('mrc_'),
  sub_merchant_id: z.string().startsWith('smrc_'),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  method: z.enum(['mobile_money', 'bank_transfer', 'demo']),
  beneficiary: z.object({
    id: z.string().startsWith('ben_').optional(),
    name: z.string().optional(),
    mobile_number: z.string().optional(),
    bank_code: z.string().optional(),
    account_number: z.string().optional(),
  }),
  reference: z.string().max(100).optional(),
  reason: z.string().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

router.post(
  '/payouts',
  authenticate(),
  idempotency('POST /payouts', { required: true }),
  async (req, res, next) => {
    try {
      requireSecretKey(req);
      const body = parseBody(createBody, req.body);
      if (body.merchant_id !== req.ogunContext.principal!.merchantId) {
        throw new Error('merchant_id does not match credentials');
      }
      const result = await createPayout({
        ...body,
        idempotency_key: req.ogunContext.idempotencyKey,
      });
      // §6.6.1 response shape
      res.status(201).json(
        success(
          {
            payout_id: result.payout.id,
            status: result.payout.status,
            amount: result.payout.amount,
            fee_amount: result.payout.fee_amount,
            total_debit: result.payout.total_debit,
            recipient_amount: result.payout.recipient_amount,
            fee_model: result.payout.fee_model,
            currency: result.payout.currency,
            method: result.payout.method,
            provider: result.payout.provider,
            reference: result.payout.external_reference,
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

const listQuery = pagination.extend({
  status: z
    .enum([
      PayoutStatus.Created,
      PayoutStatus.Queued,
      PayoutStatus.Processing,
      PayoutStatus.PendingApproval,
      PayoutStatus.PendingConfirmation,
      PayoutStatus.Succeeded,
      PayoutStatus.Failed,
      PayoutStatus.Reversed,
      PayoutStatus.Cancelled,
    ])
    .optional(),
  sub_merchant_id: z.string().startsWith('smrc_').optional(),
});

router.get('/payouts', authenticate(), async (req, res, next) => {
  try {
    const parsed = parseQuery(listQuery, req.query);
    const { page, limit } = resolvePagination(parsed);
    const { status, sub_merchant_id } = parsed;
    const result = await listPayouts({
      merchant_id: req.ogunContext.principal!.merchantId,
      sub_merchant_id,
      status,
      page,
      limit,
    });
    // §6.6.2 — list items show status but NOT provider_status
    const items = result.items.map((p) => ({
      payout_id: p.id,
      status: p.status,
      amount: p.amount,
      fee_amount: p.fee_amount,
      total_debit: p.total_debit,
      recipient_amount: p.recipient_amount,
      fee_model: p.fee_model,
      currency: p.currency,
      method: p.method,
      provider: p.provider,
      reference: p.external_reference,
      sub_merchant_id: p.sub_merchant_id,
      created_at: p.created_at,
    }));
    res.json(paginated(items, page, limit, result.total, req.ogunContext.requestId));
  } catch (err) {
    next(err);
  }
});

router.get('/payouts/:id', authenticate(), async (req, res, next) => {
  try {
    const p = await getPayout(req.params.id);
    // §6.6.3 — detail view shows status + provider_status
    res.json(
      success(
        {
          payout_id: p.id,
          status: p.status,
          provider_status: p.provider_status,
          amount: p.amount,
          fee_amount: p.fee_amount,
          total_debit: p.total_debit,
          recipient_amount: p.recipient_amount,
          fee_model: p.fee_model,
          currency: p.currency,
          method: p.method,
          provider: p.provider,
          provider_reference: p.provider_reference,
          provider_transfer_code: p.provider_transfer_code,
          wallet_reserved_amount: p.wallet_reserved_amount,
          reversal_indicator: p.reversal_indicator,
          reversal_reason: p.reversal_reason,
          failure_reason: p.failure_reason,
          sub_merchant_id: p.sub_merchant_id,
          reference: p.external_reference,
          created_at: p.created_at,
          final_resolved_at: p.final_resolved_at,
        },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
