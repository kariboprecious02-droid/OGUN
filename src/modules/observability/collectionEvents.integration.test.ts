/**
 * Observability regression tests — collection_events lifecycle.
 *
 * Verifies that:
 *   1. POST /collections with a provider failure produces the full
 *      lifecycle event chain in collection_events.
 *   2. The timed_out path records a `polling.skipped` event (the
 *      audit §3 load-bearing bug, now made visible).
 *
 * Requires: RUN_INTEGRATION=1, DATABASE_URL, REDIS_URL
 */

import {
  describeIntegration,
  setupIntegrationSchema,
  truncateAllTables,
  teardownIntegration,
} from '@/test/integration.setup';
import { createActiveMerchantFixture } from '@/test/fixtures';
import { createCollection, getCollection } from '@/modules/collection/collection.service';
import { getPool } from '@/infra/db/pool';
import { drainAsync } from '@/infra/asyncTracker';

async function getEvents(collectionId: string): Promise<Array<{ event_type: string; message: string | null }>> {
  const { rows } = await getPool().query<{ event_type: string; message: string | null }>(
    `SELECT event_type, message FROM collection_events
      WHERE collection_id = $1
      ORDER BY occurred_at`,
    [collectionId],
  );
  return rows;
}

async function settle(ms = 200): Promise<void> {
  await drainAsync();
  await new Promise((r) => setTimeout(r, ms));
}

describeIntegration('collection_events lifecycle (PR-1 acceptance)', () => {
  beforeAll(async () => {
    await setupIntegrationSchema();
  });

  afterAll(async () => {
    await teardownIntegration();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  test('demo success: lifecycle has api.received, api.validated, db.created, state.changed', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture();
    const result = await createCollection({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 1000,
      currency: 'KES',
      method: 'demo',
      customer: { phone: '+254700000001', name: 'Test' },
      reference: 'obs-test-001',
      idempotency_key: 'obs:col:1',
    });

    await settle();
    const events = await getEvents(result.collection.id);
    const types = events.map((e) => e.event_type);

    expect(types).toContain('api.received');
    expect(types).toContain('api.validated');
    expect(types).toContain('db.created');
    expect(types).toContain('state.changed');
    expect(types.length).toBeGreaterThanOrEqual(4);
  });

  test('demo failure (phone 004): lifecycle records state.changed to failed', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture();
    const result = await createCollection({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 2000,
      currency: 'KES',
      method: 'demo',
      customer: { phone: '+254700000004', name: 'Fail' },
      reference: 'obs-test-004',
      idempotency_key: 'obs:col:4',
    });

    await settle();
    const events = await getEvents(result.collection.id);
    const types = events.map((e) => e.event_type);

    expect(types).toContain('api.received');
    expect(types).toContain('db.created');
    expect(types).toContain('state.changed');

    const stateChanged = events.find((e) => e.event_type === 'state.changed');
    expect(stateChanged?.message).toMatch(/failed/i);
  });

  test('provider.timed_out path enqueues polling job (audit §3 Option A fix)', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture({
      enabledMethods: ['mpesa'],
    });

    // The Paystack connector will fail because there's no real Paystack
    // in the test env — the axios call throws, which triggers the outer
    // catch in dispatchToProviderSync. This exercises the exact same
    // path as the run-1777377952 timed_out scenario from the audit.
    const result = await createCollection({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 10000,
      currency: 'KES',
      method: 'mpesa',
      customer: { phone: '+254700190869', name: 'STK Test' },
      reference: 'obs-test-mpesa-timeout',
      idempotency_key: 'obs:col:mpesa:1',
    });

    expect(result.provider_call_state).toBe('timed_out');

    await settle();
    const events = await getEvents(result.collection.id);
    const types = events.map((e) => e.event_type);

    expect(types).toContain('api.received');
    expect(types).toContain('api.validated');
    expect(types).toContain('db.created');
    expect(types).toContain('provider.timed_out');
    expect(types).toContain('polling.enqueued');
    expect(types.length).toBeGreaterThanOrEqual(5);

    const enqueued = events.find((e) => e.event_type === 'polling.enqueued');
    expect(enqueued?.message).toMatch(/timed_out/i);

    // Verify a polling job was actually created (the audit §3 fix)
    const { rows } = await getPool().query<{ status: string; provider_reference: string | null }>(
      `SELECT status, provider_reference FROM polling_jobs
        WHERE reference_id = $1`,
      [result.collection.id],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('active');
    expect(rows[0].provider_reference).toBeNull();
  });
});
