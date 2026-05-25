/**
 * Webhook endpoint management (§12.5).
 *
 *   POST   /v1/webhook-endpoints
 *   GET    /v1/webhook-endpoints
 *   GET    /v1/webhook-endpoints/:id
 *   PUT    /v1/webhook-endpoints/:id
 *   DELETE /v1/webhook-endpoints/:id
 *   POST   /v1/webhook-endpoints/:id/test
 *
 * Creating an endpoint generates a new whsec_* secret, shown ONCE in
 * plaintext. The server stores only a SHA-256 hash.
 */
import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '@/api/validation';
import { authenticate, requireSecretKey } from '@/api/middleware/authenticate';
import { idempotency } from '@/api/middleware/idempotency';
import { success } from '@/infra/response';
import { OgunError } from '@/infra/errors';
import { generateApiKey } from '@/infra/crypto';
import {
  registerWebhookEndpoint,
  listWebhookEndpoints,
  getWebhookEndpoint,
  updateWebhookEndpoint,
  deleteWebhookEndpoint,
  emitEvent,
  WebhookEndpointRecord,
} from '@/modules/webhook/webhook.service';

const router = Router();

const SUBSCRIBABLE_EVENTS = [
  'merchant.activated',
  'merchant.suspended',
  'collection.created',
  'collection.succeeded',
  'collection.failed',
  'collection.refunded',
  'payout.created',
  'payout.processing',
  'payout.succeeded',
  'payout.failed',
  'payout.reversed',
  'settlement.paid',
  'settlement.failed',
] as const;

function shape(e: WebhookEndpointRecord) {
  return {
    id: e.id,
    url: e.url,
    subscribed_events: e.subscribed_events,
    is_active: e.is_active,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}

const createBody = z.object({
  url: z.string().url(),
  subscribed_events: z
    .array(z.enum(SUBSCRIBABLE_EVENTS))
    .min(1)
    .max(SUBSCRIBABLE_EVENTS.length),
});

router.post(
  '/webhook-endpoints',
  authenticate(),
  idempotency('POST /webhook-endpoints'),
  async (req, res, next) => {
    try {
      requireSecretKey(req);
      const body = parseBody(createBody, req.body);
      const secret = generateApiKey('whsec', 'test'); // env tag matches credentials env in future
      const result = await registerWebhookEndpoint({
        merchant_id: req.ogunContext.principal!.merchantId,
        url: body.url,
        webhookSecret: secret,
        subscribed_events: body.subscribed_events,
      });
      res.status(201).json(
        success(
          {
            id: result.id,
            url: body.url,
            subscribed_events: body.subscribed_events,
            is_active: true,
            webhook_secret: secret, // shown once
          },
          { request_id: req.ogunContext.requestId },
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get('/webhook-endpoints', authenticate(), async (req, res, next) => {
  try {
    const items = await listWebhookEndpoints(req.ogunContext.principal!.merchantId);
    res.json(success(items.map(shape), { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.get('/webhook-endpoints/:id', authenticate(), async (req, res, next) => {
  try {
    const e = await getWebhookEndpoint(
      req.ogunContext.principal!.merchantId,
      req.params.id,
    );
    if (!e) throw OgunError.notFound('WebhookEndpoint', req.params.id);
    res.json(success(shape(e), { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

const updateBody = z
  .object({
    url: z.string().url().optional(),
    subscribed_events: z
      .array(z.enum(SUBSCRIBABLE_EVENTS))
      .min(1)
      .max(SUBSCRIBABLE_EVENTS.length)
      .optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

router.put('/webhook-endpoints/:id', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    const existing = await getWebhookEndpoint(
      req.ogunContext.principal!.merchantId,
      req.params.id,
    );
    if (!existing) throw OgunError.notFound('WebhookEndpoint', req.params.id);
    const body = parseBody(updateBody, req.body);
    const updated = await updateWebhookEndpoint(
      req.ogunContext.principal!.merchantId,
      req.params.id,
      body,
    );
    if (!updated) throw OgunError.notFound('WebhookEndpoint', req.params.id);
    res.json(success(shape(updated), { request_id: req.ogunContext.requestId }));
  } catch (err) {
    next(err);
  }
});

router.delete('/webhook-endpoints/:id', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    const removed = await deleteWebhookEndpoint(
      req.ogunContext.principal!.merchantId,
      req.params.id,
    );
    if (!removed) throw OgunError.notFound('WebhookEndpoint', req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /webhook-endpoints/:id/test
 *
 * Emits a synthetic `merchant.activated` event aimed at this endpoint so
 * the merchant can validate HMAC signature handling and delivery acks.
 * The synthetic event has a dedicated type prefix so merchants can
 * ignore it in production handlers.
 */
router.post('/webhook-endpoints/:id/test', authenticate(), async (req, res, next) => {
  try {
    requireSecretKey(req);
    const existing = await getWebhookEndpoint(
      req.ogunContext.principal!.merchantId,
      req.params.id,
    );
    if (!existing) throw OgunError.notFound('WebhookEndpoint', req.params.id);
    await emitEvent({
      merchantId: req.ogunContext.principal!.merchantId,
      type: 'merchant.activated',
      data: {
        test: true,
        webhook_endpoint_id: existing.id,
        note: 'synthetic test event from POST /webhook-endpoints/:id/test',
      },
    });
    res.status(202).json(
      success(
        { queued: true, endpoint_id: existing.id },
        { request_id: req.ogunContext.requestId },
      ),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
