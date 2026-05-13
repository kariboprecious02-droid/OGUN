/**
 * Refund status poller — checks Paystack GET /refund/{id} for pending refunds.
 *
 * Runs every 60 seconds. For each collection with provider_refund_id set
 * and provider_refund_status not in a terminal state, calls Paystack to
 * check the refund status.
 *
 * Terminal states: 'processed' (customer credited), 'failed' (not credited)
 * Non-terminal: 'pending', 'processing', 'needs_attention'
 */

import { query } from '@/infra/db/pool';
import { logger } from '@/infra/logger';
import { getCollectionConnector } from '@/modules/connectors/registry';
import { recordCollectionEvent } from '@/modules/observability/collectionEvents';
import type { PaystackCollectionConnector } from '@/modules/connectors/paystack.collection.connector';

const REFUND_TERMINAL_STATES = ['processed', 'failed'];

export async function tickRefundPoller(): Promise<void> {
  const { rows } = await query<{
    id: string;
    provider_refund_id: number;
    provider_refund_status: string | null;
    provider: string;
  }>(
    `SELECT id, provider_refund_id, provider_refund_status, provider
       FROM collections
      WHERE provider_refund_id IS NOT NULL
        AND (provider_refund_status IS NULL
             OR provider_refund_status NOT IN ('processed', 'failed'))
      ORDER BY updated_at ASC
      LIMIT 20`,
  );

  for (const row of rows) {
    try {
      await checkRefundStatus(row);
    } catch (err) {
      logger.error({ err, collection_id: row.id, refund_id: row.provider_refund_id },
        'refund poller check failed');
    }
  }
}

async function checkRefundStatus(row: {
  id: string;
  provider_refund_id: number;
  provider_refund_status: string | null;
  provider: string;
}): Promise<void> {
  if (row.provider !== 'paystack') return;

  const connector = getCollectionConnector('paystack') as PaystackCollectionConnector;
  const result = await connector.getRefundStatus(row.provider_refund_id);

  logger.info({
    collection_id: row.id,
    refund_id: row.provider_refund_id,
    previous_status: row.provider_refund_status,
    new_status: result.status,
  }, 'refund poller tick');

  if (result.status === row.provider_refund_status) return;

  await query(
    `UPDATE collections SET provider_refund_status = $2, updated_at = now() WHERE id = $1`,
    [row.id, result.status],
  );

  recordCollectionEvent({
    collection_id: row.id,
    event_type: REFUND_TERMINAL_STATES.includes(result.status) ? 'refund.completed' : 'refund.dispatched',
    source: 'poller',
    payload: {
      direction: 'Paystack → Ogun',
      refund_id: row.provider_refund_id,
      refund_status: result.status,
      amount: result.amount,
      message: result.message,
    },
    message: `refund poller: ${row.provider_refund_status ?? 'unknown'} → ${result.status}`,
  });

  if (result.status === 'processed') {
    logger.info({ collection_id: row.id, refund_id: row.provider_refund_id },
      'refund confirmed processed — customer credited');
  } else if (result.status === 'failed') {
    logger.warn({ collection_id: row.id, refund_id: row.provider_refund_id },
      'refund failed on Paystack side — customer NOT credited');
  } else if (result.status === 'needs_attention') {
    logger.warn({ collection_id: row.id, refund_id: row.provider_refund_id },
      'refund needs attention — customer bank details missing');
  }
}
