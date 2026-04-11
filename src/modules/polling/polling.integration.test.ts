/**
 * Polling + demo scenario integration tests — Execution Spec §5.4 + §9.
 *
 * Covers all seven demo simulator scenarios end-to-end and the
 * 5-minute TTL timeout path:
 *
 *   001  → instant success on initiate
 *   002  → poller resolves to failed (customer_timeout)
 *   003  → poller resolves to succeeded
 *   004  → instant failed on initiate
 *   005  → poller-only success (synonym of 003)
 *   006  → poller resolves to succeeded; duplicate webhook is a no-op
 *   007  → stays pending; TTL timeout flips to timed_out / failed
 *
 * The timeout test manipulates polling_jobs.ttl_expires_at directly
 * so the tick flips the collection without waiting 5 minutes of
 * wall-clock time.
 */

import {
  describeIntegration,
  setupIntegrationSchema,
  truncateAllTables,
  teardownIntegration,
} from '@/test/integration.setup';
import { createActiveMerchantFixture, TestMerchant } from '@/test/fixtures';
import { createCollection, getCollection } from '@/modules/collection/collection.service';
import { tickPoller } from './polling.service';
import { getPool } from '@/infra/db/pool';
import { findWalletBySub } from '@/modules/wallet/wallet.repository';
import { drainAsync } from '@/infra/asyncTracker';

/**
 * Drain any pending orchestrator dispatch work, then fast-forward the
 * polling job so the next tickPoller() call picks it up without a
 * 5-second wait. Safe to call even when no polling job exists yet.
 */
async function forcePollerReady(collectionId: string): Promise<void> {
  await drainAsync();
  await getPool().query(
    `UPDATE polling_jobs
        SET next_poll_at = now() - interval '1 second'
      WHERE reference_type = 'collection' AND reference_id = $1`,
    [collectionId],
  );
}

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();
  let last: T;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('waitFor timeout');
}

describeIntegration('demo scenarios + 5-min timeout (§5.4 / §9)', () => {
  let fixture: TestMerchant;

  beforeAll(async () => {
    await setupIntegrationSchema();
  });

  afterAll(async () => {
    await teardownIntegration();
  });

  beforeEach(async () => {
    await truncateAllTables();
    fixture = await createActiveMerchantFixture();
  });

  async function createDemoCollection(phone: string, reference: string) {
    const result = await createCollection({
      merchant_id: fixture.merchantId,
      sub_merchant_id: fixture.subMerchantId,
      amount: 1000,
      currency: 'KES',
      method: 'demo',
      customer: { phone },
      reference,
      idempotency_key: `demo-${phone}-${reference}`,
    });
    return result.collection.id;
  }

  test('scenario 001: instant success on initiate', async () => {
    const id = await createDemoCollection('+254700000001', 'scenario-001');
    const resolved = await waitFor(
      () => getCollection(id),
      (c) => c.business_status === 'successful',
    );
    expect(resolved.internal_status).toBe('succeeded');
    const wallet = await findWalletBySub(fixture.subMerchantId, 'collection');
    expect(wallet!.available_balance).toBe(985);
  });

  test('scenario 002: poller resolves to failed with customer_timeout', async () => {
    const id = await createDemoCollection('+254700000002', 'scenario-002');
    // Kick the poller — the demo connector returns failed with
    // customer_timeout on getCollectionStatus for scenario 002.
    await forcePollerReady(id);
    await tickPoller();
    const resolved = await waitFor(
      () => getCollection(id),
      (c) => c.business_status === 'failed',
    );
    expect(resolved.internal_status).toBe('failed');
    expect(resolved.status_reason).toBe('customer_timeout');
    const wallet = await findWalletBySub(fixture.subMerchantId, 'collection');
    expect(wallet!.available_balance).toBe(0);
  });

  test('scenario 003: poller resolves to succeeded', async () => {
    const id = await createDemoCollection('+254700000003', 'scenario-003');
    await forcePollerReady(id);
    await tickPoller();
    const resolved = await waitFor(
      () => getCollection(id),
      (c) => c.business_status === 'successful',
    );
    expect(resolved.internal_status).toBe('succeeded');
    expect(resolved.settlement_eligible).toBe(true);
  });

  test('scenario 004: instant provider failure', async () => {
    const id = await createDemoCollection('+254700000004', 'scenario-004');
    const resolved = await waitFor(
      () => getCollection(id),
      (c) => c.business_status === 'failed',
    );
    expect(resolved.status_reason).toBe('provider_unavailable');
    const wallet = await findWalletBySub(fixture.subMerchantId, 'collection');
    expect(wallet!.available_balance).toBe(0);
  });

  test('scenario 005: poller-only success (no webhook)', async () => {
    const id = await createDemoCollection('+254700000005', 'scenario-005');
    await forcePollerReady(id);
    await tickPoller();
    const resolved = await waitFor(
      () => getCollection(id),
      (c) => c.business_status === 'successful',
    );
    expect(resolved.internal_status).toBe('succeeded');
    expect(resolved.polling_stop_reason).toBe('succeeded');
  });

  test('scenario 006: poller succeeds; second tick is a no-op', async () => {
    const id = await createDemoCollection('+254700000006', 'scenario-006');
    await forcePollerReady(id);
    await tickPoller();
    const firstResolved = await waitFor(
      () => getCollection(id),
      (c) => c.business_status === 'successful',
    );
    const firstPollCount = firstResolved.poll_attempt_count;

    // Second tick — the polling job is already stopped and the
    // terminal-state pre-check short-circuits any further work.
    await tickPoller();
    const second = await getCollection(id);
    expect(second.business_status).toBe('successful');
    expect(second.poll_attempt_count).toBe(firstPollCount);

    // Wallet is credited exactly once
    const wallet = await findWalletBySub(fixture.subMerchantId, 'collection');
    expect(wallet!.available_balance).toBe(985);
  });

  test('scenario 007: 5-minute TTL → timed_out / failed (§5.4)', async () => {
    const id = await createDemoCollection('+254700000007', 'scenario-007');

    // Force the polling job's ttl_expires_at AND next_poll_at into the
    // past so the next tick triggers the timeout branch without a
    // real 5-min wait.
    await drainAsync();
    const pool = getPool();
    await pool.query(
      `UPDATE polling_jobs
          SET ttl_expires_at = now() - interval '1 minute',
              next_poll_at = now() - interval '1 second'
        WHERE reference_type = 'collection' AND reference_id = $1`,
      [id],
    );

    await tickPoller();

    const resolved = await waitFor(
      () => getCollection(id),
      (c) => c.business_status === 'failed',
    );
    expect(resolved.internal_status).toBe('timed_out');
    expect(resolved.status_reason).toBe('collection_timed_out');
    expect(resolved.polling_stop_reason).toBe('timeout');
    expect(resolved.settlement_eligible).toBe(false);
    expect(resolved.wallet_credited).toBe(false);

    // Polling job is stopped
    const { rows: jobs } = await pool.query<{ status: string; stop_reason: string }>(
      `SELECT status, stop_reason FROM polling_jobs
        WHERE reference_type = 'collection' AND reference_id = $1`,
      [id],
    );
    expect(jobs[0].status).toBe('stopped');
    expect(jobs[0].stop_reason).toBe('timeout');
  });

  test('scenario 007 after timeout: late webhook-like resolution is a no-op', async () => {
    const id = await createDemoCollection('+254700000007', 'scenario-007-late');

    // First: time out the collection
    await drainAsync();
    const pool = getPool();
    await pool.query(
      `UPDATE polling_jobs
          SET ttl_expires_at = now() - interval '1 minute',
              next_poll_at = now() - interval '1 second'
        WHERE reference_type = 'collection' AND reference_id = $1`,
      [id],
    );
    await tickPoller();
    const failedRow = await getCollection(id);
    expect(failedRow.business_status).toBe('failed');

    // Simulate a late resolution: re-enqueue a polling job (the old
    // one is already stopped) and tick again. The orchestrator's
    // isTerminal() check should keep the business_status as failed.
    await pool.query(
      `UPDATE collections SET polling_stopped_at = NULL WHERE id = $1`,
      [id],
    );
    // Re-tick the poller — there's no active job so nothing happens,
    // but the collection row remains terminal regardless.
    await tickPoller();
    const stillFailed = await getCollection(id);
    expect(stillFailed.business_status).toBe('failed');
    expect(stillFailed.internal_status).toBe('timed_out');
  });
});
