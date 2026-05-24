import { query } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { logger } from '@/infra/logger';
import { getRequestId } from '@/infra/requestContext';

export type PayoutEventType =
  | 'provider.requested'
  | 'provider.responded'
  | 'provider.errored'
  | 'provider.timed_out'
  | 'polling.enqueued'
  | 'polling.tick'
  | 'state.changed'
  | 'wallet.reserved'
  | 'wallet.finalized'
  | 'wallet.released'
  | 'dispatch.started'
  | 'dispatch.completed'
  | 'dispatch.failed'
  | 'sync.requested';

export type PayoutEventSource =
  | 'api'
  | 'orchestrator'
  | 'connector'
  | 'poller'
  | 'webhook'
  | 'admin';

export type RecordPayoutEventInput = {
  payout_id: string;
  event_type: PayoutEventType;
  source: PayoutEventSource;
  request_id?: string;
  http_status?: number;
  latency_ms?: number;
  payload?: Record<string, unknown>;
  message?: string;
};

export function recordPayoutEvent(input: RecordPayoutEventInput): void {
  doRecordEvent(input).catch((err) => {
    logger.error({ err, event_type: input.event_type, payout_id: input.payout_id },
      'failed to record payout event');
  });
}

async function doRecordEvent(input: RecordPayoutEventInput): Promise<void> {
  const id = newId('event');
  const requestId = input.request_id ?? getRequestId() ?? null;
  await query(
    `INSERT INTO payout_events
       (id, payout_id, event_type, source, occurred_at, request_id,
        http_status, latency_ms, payload, message)
     VALUES ($1,$2,$3,$4,clock_timestamp(),$5,$6,$7,$8,$9)`,
    [
      id,
      input.payout_id,
      input.event_type,
      input.source,
      requestId,
      input.http_status ?? null,
      input.latency_ms ?? null,
      JSON.stringify(input.payload ?? {}),
      input.message ?? null,
    ],
  );
}
