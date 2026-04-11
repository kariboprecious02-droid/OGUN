/**
 * Outbound webhook dispatch (§8).
 *
 *   Headers:
 *     X-Ogun-Signature: sha256=<HMAC-SHA256(raw_body, webhook_secret)>
 *     X-Ogun-Timestamp: ISO 8601
 *     X-Ogun-Event-Id:  evt_<ulid>
 *
 *   Retry schedule:
 *     5s, 30s, 2m, 10m, 1h, 6h, 24h   (7 attempts)
 *   100 consecutive failures → auto-disable endpoint + notify merchant.
 */

import axios from 'axios';
import { query } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { hmacSha256Hex, sha256Hex } from '@/infra/crypto';
import { logger } from '@/infra/logger';
import { config } from '@/infra/config';

const RETRY_SCHEDULE_SECONDS = [5, 30, 120, 600, 3600, 21_600, 86_400];

type WebhookEndpointRow = {
  id: string;
  merchant_id: string;
  url: string;
  secret_hash: string;
  subscribed_events: string[];
  is_active: boolean;
};

export type OgunEventType =
  | 'merchant.activated'
  | 'merchant.suspended'
  | 'collection.created'
  | 'collection.succeeded'
  | 'collection.failed'
  | 'collection.refunded'
  | 'payout.created'
  | 'payout.succeeded'
  | 'payout.failed'
  | 'payout.reversed'
  | 'settlement.paid'
  | 'settlement.failed';

export type WebhookEndpointRecord = {
  id: string;
  merchant_id: string;
  url: string;
  subscribed_events: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export async function registerWebhookEndpoint(input: {
  merchant_id: string;
  url: string;
  webhookSecret: string;
  subscribed_events: string[];
}): Promise<{ id: string }> {
  const id = newId('webhookEndpoint');
  const secretHash = sha256Hex(input.webhookSecret);
  await query(
    `INSERT INTO webhook_endpoints (id, merchant_id, url, secret_hash, subscribed_events)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, input.merchant_id, input.url, secretHash, input.subscribed_events],
  );
  return { id };
}

export async function listWebhookEndpoints(
  merchantId: string,
): Promise<WebhookEndpointRecord[]> {
  const { rows } = await query<WebhookEndpointRecord>(
    `SELECT id, merchant_id, url, subscribed_events, is_active, created_at, updated_at
       FROM webhook_endpoints
      WHERE merchant_id = $1
      ORDER BY created_at DESC`,
    [merchantId],
  );
  return rows;
}

export async function getWebhookEndpoint(
  merchantId: string,
  id: string,
): Promise<WebhookEndpointRecord | null> {
  const { rows } = await query<WebhookEndpointRecord>(
    `SELECT id, merchant_id, url, subscribed_events, is_active, created_at, updated_at
       FROM webhook_endpoints
      WHERE id = $1 AND merchant_id = $2
      LIMIT 1`,
    [id, merchantId],
  );
  return rows[0] ?? null;
}

export async function updateWebhookEndpoint(
  merchantId: string,
  id: string,
  patch: { url?: string; subscribed_events?: string[]; is_active?: boolean },
): Promise<WebhookEndpointRecord | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 3;
  if (patch.url !== undefined) {
    sets.push(`url = $${i++}`);
    vals.push(patch.url);
  }
  if (patch.subscribed_events !== undefined) {
    sets.push(`subscribed_events = $${i++}`);
    vals.push(patch.subscribed_events);
  }
  if (patch.is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    vals.push(patch.is_active);
  }
  if (!sets.length) return getWebhookEndpoint(merchantId, id);
  sets.push('updated_at = now()');
  const { rows } = await query<WebhookEndpointRecord>(
    `UPDATE webhook_endpoints SET ${sets.join(', ')}
      WHERE id = $1 AND merchant_id = $2
      RETURNING id, merchant_id, url, subscribed_events, is_active, created_at, updated_at`,
    [id, merchantId, ...vals],
  );
  return rows[0] ?? null;
}

export async function deleteWebhookEndpoint(
  merchantId: string,
  id: string,
): Promise<boolean> {
  const res = await query(
    `DELETE FROM webhook_endpoints WHERE id = $1 AND merchant_id = $2`,
    [id, merchantId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Emit a domain event for a merchant. Enqueues a WebhookDelivery row
 * for every active endpoint subscribed to the event. A background worker
 * actually dispatches the HTTP calls.
 */
export async function emitEvent(input: {
  merchantId: string;
  type: OgunEventType;
  data: Record<string, unknown>;
}): Promise<void> {
  const eventId = newId('event');
  const payload = {
    id: eventId,
    type: input.type,
    created_at: new Date().toISOString(),
    data: input.data,
  };
  const payloadStr = JSON.stringify(payload);
  const payloadHash = sha256Hex(payloadStr);

  const { rows: endpoints } = await query<WebhookEndpointRow>(
    `SELECT * FROM webhook_endpoints
      WHERE merchant_id = $1 AND is_active = true
        AND ($2 = ANY(subscribed_events) OR array_length(subscribed_events, 1) IS NULL)`,
    [input.merchantId, input.type],
  );

  if (endpoints.length === 0) {
    logger.debug({ type: input.type, merchant_id: input.merchantId }, 'no webhook endpoints registered');
    return;
  }

  for (const ep of endpoints) {
    await query(
      `INSERT INTO webhook_deliveries
         (id, merchant_id, webhook_endpoint_id, event_type, event_id,
          payload, payload_hash, delivery_status, attempt_count, next_retry_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',0, now())`,
      [
        newId('webhookDelivery'),
        input.merchantId,
        ep.id,
        input.type,
        eventId,
        payloadStr,
        payloadHash,
      ],
    );
  }
}

/**
 * Dispatch a single pending delivery. Called by the outbound worker.
 * Returns true if the delivery succeeded, false otherwise.
 */
export async function dispatchDelivery(deliveryId: string): Promise<boolean> {
  const { rows } = await query<{
    id: string;
    merchant_id: string;
    webhook_endpoint_id: string;
    event_id: string;
    event_type: string;
    payload: string;
    attempt_count: number;
    url: string;
    secret_hash: string;
  }>(
    `SELECT d.id, d.merchant_id, d.webhook_endpoint_id, d.event_id, d.event_type,
            d.payload, d.attempt_count, e.url, e.secret_hash
       FROM webhook_deliveries d
       JOIN webhook_endpoints e ON e.id = d.webhook_endpoint_id
      WHERE d.id = $1`,
    [deliveryId],
  );
  const delivery = rows[0];
  if (!delivery) return false;

  const rawBody = typeof delivery.payload === 'string' ? delivery.payload : JSON.stringify(delivery.payload);
  // In MVP we keep the webhook secret in plaintext in config; in production,
  // the endpoint's whsec is stored encrypted and retrieved for signing.
  // The demo uses the platform-wide salt as the signing secret for dev.
  const signingSecret = config.platform.webhookSigningSalt;
  const signature = `sha256=${hmacSha256Hex(rawBody, signingSecret)}`;
  const timestamp = new Date().toISOString();

  try {
    const res = await axios.post(delivery.url, rawBody, {
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        'X-Ogun-Signature': signature,
        'X-Ogun-Timestamp': timestamp,
        'X-Ogun-Event-Id': delivery.event_id,
      },
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 300) {
      await query(
        `UPDATE webhook_deliveries
            SET delivery_status = 'delivered',
                http_status = $2,
                attempt_count = attempt_count + 1,
                last_attempt_at = now(),
                next_retry_at = NULL
          WHERE id = $1`,
        [delivery.id, res.status],
      );
      return true;
    }
    await scheduleRetry(delivery.id, delivery.attempt_count + 1, res.status, `http_${res.status}`);
    return false;
  } catch (err) {
    await scheduleRetry(delivery.id, delivery.attempt_count + 1, null, (err as Error).message);
    return false;
  }
}

async function scheduleRetry(
  deliveryId: string,
  attempt: number,
  httpStatus: number | null,
  errorMsg: string,
): Promise<void> {
  if (attempt > RETRY_SCHEDULE_SECONDS.length) {
    await query(
      `UPDATE webhook_deliveries
          SET delivery_status = 'failed',
              http_status = $2,
              attempt_count = $3,
              last_attempt_at = now(),
              next_retry_at = NULL,
              last_error = $4
        WHERE id = $1`,
      [deliveryId, httpStatus, attempt, errorMsg],
    );
    return;
  }
  const delaySec = RETRY_SCHEDULE_SECONDS[attempt - 1];
  await query(
    `UPDATE webhook_deliveries
        SET delivery_status = 'pending',
            http_status = $2,
            attempt_count = $3,
            last_attempt_at = now(),
            next_retry_at = now() + ($4 || ' seconds')::interval,
            last_error = $5
      WHERE id = $1`,
    [deliveryId, httpStatus, attempt, String(delaySec), errorMsg],
  );
}
