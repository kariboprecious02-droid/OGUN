/**
 * Polling module — Execution Spec §5.4.
 *
 *   Poll every 5 seconds. Max 5 minutes from provider_submission_at.
 *   BEFORE each poll: check DB for terminal internal_status or
 *   webhook_received_at — if found, stop immediately.
 *   After 5 minutes with no conclusive result: timeout-to-failed.
 */

import { query } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { config } from '@/infra/config';
import { logger } from '@/infra/logger';
import { getCollectionConnector } from '@/modules/connectors/registry';
import { findCollection } from '@/modules/collection/collection.repository';
import {
  resolveCollection,
  timeoutCollection,
} from '@/modules/collection/collection.service';
import { isTerminal } from '@/modules/collection/collection.types';

export type PollingJobRow = {
  id: string;
  reference_type: 'collection' | 'payout';
  reference_id: string;
  provider_reference: string | null;
  provider: string;
  poll_count: number;
  started_at: Date;
  next_poll_at: Date;
  ttl_expires_at: Date;
  stopped_at: Date | null;
  stop_reason: string | null;
  status: 'active' | 'stopped';
};

export async function enqueuePollingJob(input: {
  referenceType: 'collection' | 'payout';
  referenceId: string;
  providerReference: string | null;
  provider: string;
}): Promise<void> {
  const now = new Date();
  const interval = config.polling.intervalSeconds * 1000;
  const ttl = config.polling.ttlSeconds * 1000;
  await query(
    `INSERT INTO polling_jobs
       (id, reference_type, reference_id, provider_reference, provider,
        started_at, next_poll_at, ttl_expires_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
     ON CONFLICT (reference_type, reference_id) DO UPDATE SET
       next_poll_at = EXCLUDED.next_poll_at,
       ttl_expires_at = CASE
         WHEN polling_jobs.status = 'active' THEN polling_jobs.ttl_expires_at
         ELSE EXCLUDED.ttl_expires_at
       END,
       provider_reference = COALESCE(EXCLUDED.provider_reference, polling_jobs.provider_reference),
       status = 'active'`,
    [
      newId('pollingJob'),
      input.referenceType,
      input.referenceId,
      input.providerReference,
      input.provider,
      now,
      new Date(now.getTime() + interval),
      new Date(now.getTime() + ttl),
    ],
  );
}

export async function stopPollingJob(
  referenceType: 'collection' | 'payout',
  referenceId: string,
  reason: string,
): Promise<void> {
  await query(
    `UPDATE polling_jobs
        SET status = 'stopped', stopped_at = now(), stop_reason = $3
      WHERE reference_type = $1 AND reference_id = $2`,
    [referenceType, referenceId, reason],
  );
}

/**
 * Tick the poller — called by a scheduled worker on a short interval.
 * Processes all active jobs whose `next_poll_at` has arrived.
 */
export async function tickPoller(now = new Date()): Promise<void> {
  const { rows } = await query<PollingJobRow>(
    `SELECT * FROM polling_jobs
      WHERE status = 'active'
        AND next_poll_at <= $1
      ORDER BY next_poll_at
      LIMIT 100`,
    [now],
  );

  for (const job of rows) {
    try {
      await processJob(job, now);
    } catch (err) {
      logger.error({ err, job_id: job.id }, 'poller job failed');
    }
  }
}

async function processJob(job: PollingJobRow, now: Date): Promise<void> {
  // TTL check first
  if (job.ttl_expires_at <= now) {
    if (job.reference_type === 'collection') {
      await timeoutCollection(job.reference_id);
    }
    await stopPollingJob(job.reference_type, job.reference_id, 'timeout');
    return;
  }

  if (job.reference_type === 'collection') {
    const row = await findCollection(job.reference_id);
    if (!row) {
      await stopPollingJob(job.reference_type, job.reference_id, 'missing_ref');
      return;
    }
    // §5.4: terminal-state pre-check
    if (isTerminal(row.internal_status) || row.webhook_received_at) {
      await stopPollingJob(job.reference_type, job.reference_id, 'terminal_pre_check');
      return;
    }

    const connector = getCollectionConnector(row.provider);
    const result = await connector.getCollectionStatus(
      job.provider_reference ?? row.provider_reference ?? '',
    );

    if (result.normalized_status === 'succeeded') {
      await resolveCollection(row.id, {
        source: 'poller',
        normalizedStatus: 'succeeded',
        providerReference: result.provider_reference,
      });
      await stopPollingJob(job.reference_type, job.reference_id, 'succeeded');
      return;
    }
    if (result.normalized_status === 'failed') {
      await resolveCollection(row.id, {
        source: 'poller',
        normalizedStatus: 'failed',
        providerReference: result.provider_reference,
        failureReason: result.error_code ?? 'poller_reported_failure',
      });
      await stopPollingJob(job.reference_type, job.reference_id, 'failed');
      return;
    }

    // Still unresolved — schedule next poll
    const next = new Date(now.getTime() + config.polling.intervalSeconds * 1000);
    await query(
      `UPDATE polling_jobs
         SET poll_count = poll_count + 1, next_poll_at = $2
       WHERE id = $1`,
      [job.id, next],
    );
    await query(
      `UPDATE collections
          SET last_polled_at = $2, poll_attempt_count = poll_attempt_count + 1
        WHERE id = $1`,
      [row.id, now],
    );
  }
}
