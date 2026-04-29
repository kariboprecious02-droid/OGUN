/**
 * Inbound provider webhook endpoints (Safaricom callbacks, Paystack events).
 *
 * These endpoints are NOT authenticated with Ogun Bearer keys — they are
 * called directly by providers. Signature validation is handled per
 * connector.  We use raw body middleware to keep the bytes intact for
 * HMAC verification.
 */
import { Router, raw } from 'express';
import { logger } from '@/infra/logger';
import { OgunError } from '@/infra/errors';
import { getCollectionConnector, getPayoutConnector } from '@/modules/connectors/registry';
import {
  findCollectionByProviderRef,
  resolveCollection,
} from '@/modules/collection/collection.service';
import { findPayoutByProviderRef, resolvePayout } from '@/modules/payout/payout.service';
import { sha256Hex } from '@/infra/crypto';
import { recordCollectionEvent } from '@/modules/observability/collectionEvents';

const router = Router();

router.post('/webhooks/safaricom', raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body as Buffer;
  try {
    const connector = getCollectionConnector('safaricom');
    if (!connector.validateWebhookSignature(payload, req.headers as Record<string, string>)) {
      return res.status(401).send('invalid signature');
    }
    const parsed = connector.parseWebhook(payload, req.headers as Record<string, string>);
    const collection = await findCollectionByProviderRef(parsed.provider_reference);
    if (!collection) {
      logger.warn({ ref: parsed.provider_reference }, 'unknown collection in safaricom webhook');
      return res.status(200).send('ok');
    }

    recordCollectionEvent({
      collection_id: collection.id,
      event_type: 'webhook.received',
      source: 'webhook',
      payload: {
        provider: 'safaricom',
        provider_reference: parsed.provider_reference,
        normalized_status: parsed.normalized_status,
        failure_reason: parsed.failure_reason,
      },
      message: `safaricom webhook: ${parsed.normalized_status}`,
    });

    if (parsed.normalized_status === 'succeeded' || parsed.normalized_status === 'failed') {
      await resolveCollection(collection.id, {
        source: 'webhook',
        normalizedStatus: parsed.normalized_status,
        providerReference: parsed.provider_reference,
        failureReason: parsed.failure_reason,
        payloadHash: sha256Hex(payload),
      });
    }
    return res.status(200).send('ok');
  } catch (err) {
    logger.error({ err }, 'safaricom webhook processing failed');
    return res.status(200).send('ok');
  }
});

router.post('/webhooks/paystack', raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body as Buffer;
  try {
    // Both collection and payout events come through the same endpoint;
    // the event type dictates which connector handles it.
    const body = JSON.parse(payload.toString('utf8')) as { event?: string; data?: { reference?: string } };
    const event = body.event ?? '';

    if (event.startsWith('charge.')) {
      const connector = getCollectionConnector('paystack');
      if (!connector.validateWebhookSignature(payload, req.headers as Record<string, string>)) {
        return res.status(401).send('invalid signature');
      }
      const parsed = connector.parseWebhook(payload, req.headers as Record<string, string>);
      const collection = await findCollectionByProviderRef(parsed.provider_reference);
      if (!collection) return res.status(200).send('ok');

      recordCollectionEvent({
        collection_id: collection.id,
        event_type: 'webhook.received',
        source: 'webhook',
        payload: {
          event,
          provider_reference: parsed.provider_reference,
          normalized_status: parsed.normalized_status,
          failure_reason: parsed.failure_reason,
        },
        message: `paystack webhook: ${event} → ${parsed.normalized_status}`,
      });

      if (parsed.normalized_status === 'succeeded' || parsed.normalized_status === 'failed') {
        await resolveCollection(collection.id, {
          source: 'webhook',
          normalizedStatus: parsed.normalized_status,
          providerReference: parsed.provider_reference,
          failureReason: parsed.failure_reason,
          payloadHash: sha256Hex(payload),
        });
      }
      return res.status(200).send('ok');
    }

    if (event.startsWith('transfer.')) {
      const connector = getPayoutConnector('paystack');
      if (!connector.validateWebhookSignature(payload, req.headers as Record<string, string>)) {
        return res.status(401).send('invalid signature');
      }
      const parsed = connector.parseWebhook(payload, req.headers as Record<string, string>);
      const payout = await findPayoutByProviderRef(parsed.provider_reference);
      if (!payout) return res.status(200).send('ok');
      const normalized =
        parsed.normalized_status === 'succeeded'
          ? 'succeeded'
          : parsed.normalized_status === 'failed'
          ? 'failed'
          : parsed.normalized_status === 'reversed'
          ? 'reversed'
          : null;
      if (normalized) {
        await resolvePayout(payout.id, {
          source: 'webhook',
          normalizedStatus: normalized,
          providerReference: parsed.provider_reference,
          failureReason: parsed.failure_reason,
          reversalReason: normalized === 'reversed' ? parsed.failure_reason : undefined,
        });
      }
      return res.status(200).send('ok');
    }

    return res.status(200).send('ok');
  } catch (err) {
    logger.error({ err }, 'paystack webhook processing failed');
    return res.status(200).send('ok');
  }
});

// Demo webhook simulator (sandbox only)
router.post('/webhooks/demo', raw({ type: 'application/json' }), async (req, res) => {
  const payload = req.body as Buffer;
  try {
    const connector = getCollectionConnector('demo');
    const parsed = connector.parseWebhook(payload, req.headers as Record<string, string>);
    const collection = await findCollectionByProviderRef(parsed.provider_reference);
    if (!collection) return res.status(200).send('ok');
    if (parsed.normalized_status === 'succeeded' || parsed.normalized_status === 'failed') {
      await resolveCollection(collection.id, {
        source: 'webhook',
        normalizedStatus: parsed.normalized_status,
        providerReference: parsed.provider_reference,
        failureReason: parsed.failure_reason,
        payloadHash: sha256Hex(payload),
      });
    }
    return res.status(200).send('ok');
  } catch (err) {
    throw OgunError.invalidRequest('Invalid demo webhook');
  }
});

export default router;
