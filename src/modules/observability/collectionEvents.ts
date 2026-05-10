import { query } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { logger } from '@/infra/logger';
import { getRequestId } from '@/infra/requestContext';

export type CollectionEventType =
  | 'api.received'
  | 'api.validated'
  | 'db.created'
  | 'provider.requested'
  | 'provider.responded'
  | 'provider.errored'
  | 'provider.timed_out'
  | 'polling.enqueued'
  | 'polling.skipped'
  | 'polling.tick'
  | 'polling.timeout'
  | 'webhook.received'
  | 'state.changed'
  | 'wallet.credited'
  | 'refund.requested';

export type CollectionEventSource =
  | 'api'
  | 'orchestrator'
  | 'connector'
  | 'poller'
  | 'webhook'
  | 'admin';

export type RecordCollectionEventInput = {
  collection_id: string;
  event_type: CollectionEventType;
  source: CollectionEventSource;
  request_id?: string;
  http_status?: number;
  latency_ms?: number;
  payload?: Record<string, unknown>;
  message?: string;
};

export function recordCollectionEvent(input: RecordCollectionEventInput): void {
  const id = newId('event');
  const requestId = input.request_id ?? getRequestId() ?? null;
  query(
    `INSERT INTO collection_events
       (id, collection_id, event_type, source, occurred_at, request_id,
        http_status, latency_ms, payload, message)
     VALUES ($1,$2,$3,$4,clock_timestamp(),$5,$6,$7,$8,$9)`,
    [
      id,
      input.collection_id,
      input.event_type,
      input.source,
      requestId,
      input.http_status ?? null,
      input.latency_ms ?? null,
      JSON.stringify(input.payload ?? {}),
      input.message ?? null,
    ],
  ).catch((err) => {
    logger.error({ err, event_type: input.event_type, collection_id: input.collection_id },
      'failed to record collection event');
  });
}
