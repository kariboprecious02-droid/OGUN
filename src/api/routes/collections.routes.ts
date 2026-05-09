import { Router } from 'express';
import { z } from 'zod';
import { parseBody, parseQuery, pagination, resolvePagination } from '@/api/validation';
import { idempotency } from '@/api/middleware/idempotency';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { success, paginated } from '@/infra/response';
import {
  createCollection,
  getCollection,
  listCollections,
  syncCollection,
  refundCollection,
} from '@/modules/collection/collection.service';
import { CollectionBusinessStatus } from '@/modules/collection/collection.types';
import { enforceRateLimit } from '@/infra/rateLimit';
import { OgunError } from '@/infra/errors';

const router = Router();

const createBody = z.object({
  merchant_id: z.string().startsWith('mrc_'),
  sub_merchant_id: z.string().startsWith('smrc_'),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  method: z.enum(['mpesa', 'airtel', 'till', 'card', 'bank', 'demo']),
  customer: z.object({
    phone: z.string().min(6),
    name: z.string().optional(),
    email: z.string().email().optional(),
  }),
  reference: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

router.post(
  '/collections',
  authenticate(),
  idempotency('POST /collections', { required: true }),
  async (req, res, next) => {
    try {
      requireSecretKey(req);
      const body = parseBody(createBody, req.body);
      if (body.merchant_id !== req.ogunContext.principal!.merchantId) {
        throw new Error('merchant_id does not match credentials');
      }
      const result = await createCollection({
        ...body,
        idempotency_key: req.ogunContext.idempotencyKey,
      });
      res.status(201).json(
        success(
          {
            id: result.collection.id,
            business_status: result.business_status,
            amount: result.collection.amount,
            fee_amount: result.collection.fee_amount,
            customer_amount: result.collection.customer_amount,
            currency: result.collection.currency,
            method: result.collection.method,
            provider: result.collection.provider,
            provider_reference: result.collection.provider_reference ?? null,
            provider_call_state: result.provider_call_state,
            next_action: result.next_action,
            provider_message: result.provider_message,
            failure_reason: result.failure_reason,
            reference: result.collection.merchant_reference,
            created_at: result.collection.created_at,
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
      CollectionBusinessStatus.Pending,
      CollectionBusinessStatus.Successful,
      CollectionBusinessStatus.Failed,
      CollectionBusinessStatus.Refunded,
    ])
    .optional(),
  sub_merchant_id: z.string().startsWith('smrc_').optional(),
});

router.get('/collections', authenticate(), async (req, res, next) => {
  try {
    const parsed = parseQuery(listQuery, req.query);
    const { page, limit } = resolvePagination(parsed);
    const { status, sub_merchant_id } = parsed;
    const result = await listCollections({
      merchant_id: req.ogunContext.principal!.merchantId,
      sub_merchant_id,
      business_status: status,
      page,
      limit,
    });
    // §5.6.2 — list view returns business_status only (no internal_status)
    const items = result.items.map((c) => ({
      id: c.id,
      business_status: c.business_status,
      amount: c.amount,
      fee_amount: c.fee_amount,
      currency: c.currency,
      method: c.method,
      provider: c.provider,
      reference: c.merchant_reference,
      sub_merchant_id: c.sub_merchant_id,
      created_at: c.created_at,
    }));
    res.json(paginated(items, page, limit, result.total, req.ogunContext.requestId));
  } catch (err) {
    next(err);
  }
});

router.get('/collections/:id', authenticate(), async (req, res, next) => {
  try {
    const c = await getCollection(req.params.id);
    // §5.6.3 — detail view returns BOTH business_status AND internal_status
    res.json(
      success(
        {
          id: c.id,
          business_status: c.business_status,
          internal_status: c.internal_status,
          status_reason: c.status_reason,
          amount: c.amount,
          fee_amount: c.fee_amount,
          customer_amount: c.customer_amount,
          currency: c.currency,
          method: c.method,
          provider: c.provider,
          provider_reference: c.provider_reference,
          provider_call_state: c.provider_call_state ?? null,
          provider_message: c.provider_message ?? null,
          next_action: c.next_action ?? null,
          failure_reason: c.failure_reason ?? null,
          reference: c.merchant_reference,
          sub_merchant_id: c.sub_merchant_id,
          settlement_eligible: c.settlement_eligible,
          wallet_credited: c.wallet_credited,
          refund_status: c.refund_status,
          refunded_amount: c.refunded_amount ?? null,
          refund_timestamp: c.refund_timestamp ?? null,
          refund_reference: c.refund_reference ?? null,
          webhook_received_at: c.webhook_received_at ?? null,
          poll_attempt_count: c.poll_attempt_count,
          polling_stop_reason: c.polling_stop_reason,
          metadata: c.metadata,
          created_at: c.created_at,
          final_resolved_at: c.final_resolved_at,
        },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Refund a successful collection (§5.8).
 * Partial refunds allowed as long as the running total stays
 * within the original collection amount.
 */
const refundBody = z.object({
  amount: z.number().int().positive(),
  reference: z.string().max(100).optional(),
  reason: z.string().max(200).optional(),
});

router.post(
  '/collections/:id/refund',
  authenticate(),
  idempotency('POST /collections/:id/refund', { required: true }),
  async (req, res, next) => {
    try {
      requireSecretKey(req);
      const existing = await getCollection(req.params.id);
      if (existing.merchant_id !== req.ogunContext.principal!.merchantId) {
        throw OgunError.notFound('Collection', req.params.id);
      }
      const body = parseBody(refundBody, req.body);
      const c = await refundCollection({
        collection_id: existing.id,
        amount: body.amount,
        reference: body.reference,
        reason: body.reason,
      });
      res.json(
        success(
          {
            id: c.id,
            business_status: c.business_status,
            internal_status: c.internal_status,
            amount: c.amount,
            refund_status: c.refund_status,
            refunded_amount: c.refunded_amount,
            refund_timestamp: c.refund_timestamp,
            refund_reference: c.refund_reference,
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

/**
 * Force a provider status query. §12.3.
 * Rate-limited to 1 call per collection per minute.
 */
router.post('/collections/:id/sync', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    // Verify ownership first (and 404 if missing)
    const existing = await getCollection(req.params.id);
    if (existing.merchant_id !== req.ogunContext.principal!.merchantId) {
      throw OgunError.notFound('Collection', req.params.id);
    }
    await enforceRateLimit(`collection_sync:${existing.id}`, 60, 1);
    const c = await syncCollection(existing.id);
    res.json(
      success(
        {
          id: c.id,
          business_status: c.business_status,
          internal_status: c.internal_status,
          status_reason: c.status_reason,
          amount: c.amount,
          fee_amount: c.fee_amount,
          currency: c.currency,
          method: c.method,
          provider: c.provider,
          provider_reference: c.provider_reference,
          settlement_eligible: c.settlement_eligible,
          wallet_credited: c.wallet_credited,
          refund_status: c.refund_status,
        },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
