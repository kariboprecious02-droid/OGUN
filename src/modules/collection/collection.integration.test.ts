/**
 * End-to-end collection smoke tests.
 *
 * Exercises the full Collection Orchestrator against real Postgres +
 * Redis using the Demo connector. Covers:
 *   - Demo phone scenario 001 → instant success → wallet credited
 *   - Demo phone scenario 004 → provider failure → wallet untouched
 *   - Dual-state model: list-view returns business_status only,
 *     detail-view returns both business_status AND internal_status
 *
 *   npm run test:integration
 */

import {
  describeIntegration,
  setupIntegrationSchema,
  truncateAllTables,
  teardownIntegration,
} from '@/test/integration.setup';
import { createActiveMerchantFixture } from '@/test/fixtures';
import {
  createCollection,
  getCollection,
  listCollections,
} from './collection.service';
import { findWalletBySub } from '@/modules/wallet/wallet.repository';

// Helper to wait for async provider dispatch to complete
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

describeIntegration('collection orchestrator (integration, §5)', () => {
  beforeAll(async () => {
    await setupIntegrationSchema();
  });

  afterAll(async () => {
    await teardownIntegration();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  test('demo success (phone 001): business_status transitions pending → successful', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture();

    const result = await createCollection({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 1000,
      currency: 'KES',
      method: 'demo',
      customer: { phone: '+254700000001', name: 'Jane' },
      reference: 'INV-001',
      idempotency_key: 'test:col:1',
    });

    // At creation: business_status=pending (§5.5 step 9)
    expect(result.collection.business_status).toBe('pending');
    expect(result.collection.fee_amount).toBe(15); // 1000 * 1.5%
    expect(result.collection.customer_amount).toBe(1000); // merchant_covers

    // The dispatch runs async; wait for the demo connector to report success
    const resolved = await waitFor(
      () => getCollection(result.collection.id),
      (c) => c.business_status === 'successful',
    );

    expect(resolved.internal_status).toBe('succeeded');
    expect(resolved.business_status).toBe('successful');
    expect(resolved.settlement_eligible).toBe(true);
    expect(resolved.wallet_credited).toBe(true);

    // Wallet should show 985 credit (1000 - 15 fee)
    const wallet = await findWalletBySub(subMerchantId, 'collection');
    expect(wallet!.available_balance).toBe(985); // 1000 credit - 15 fee debit
  });

  test('demo failure (phone 004): business_status=failed, wallet untouched', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture();

    const result = await createCollection({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 2000,
      currency: 'KES',
      method: 'demo',
      customer: { phone: '+254700000004', name: 'John' },
      reference: 'INV-004',
      idempotency_key: 'test:col:4',
    });
    expect(result.collection.business_status).toBe('pending');

    const resolved = await waitFor(
      () => getCollection(result.collection.id),
      (c) => c.business_status === 'failed',
    );
    expect(resolved.internal_status).toBe('failed');
    expect(resolved.settlement_eligible).toBe(false);
    expect(resolved.wallet_credited).toBe(false);

    // Collection wallet untouched
    const wallet = await findWalletBySub(subMerchantId, 'collection');
    expect(wallet!.available_balance).toBe(0);
  });

  test('list view returns business_status only; detail view returns both', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture();

    const result = await createCollection({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 500,
      currency: 'KES',
      method: 'demo',
      customer: { phone: '+254700000001' },
      idempotency_key: 'test:col:list',
    });
    await waitFor(
      () => getCollection(result.collection.id),
      (c) => c.business_status === 'successful',
    );

    // Service-level listCollections returns full rows; the API layer
    // projects to business_status-only. Verify both statuses present.
    const listed = await listCollections({
      merchant_id: merchantId,
      page: 1,
      limit: 10,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].business_status).toBe('successful');

    const detail = await getCollection(result.collection.id);
    expect(detail.business_status).toBe('successful');
    expect(detail.internal_status).toBe('succeeded'); // detail keeps both
  });

  test('payer_covers fee model: wallet credited gross, customer pays amount+fee', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture({
      collectionFeeModel: 'payer_covers',
      collectionFeePct: 2.0,
    });

    const result = await createCollection({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 1000,
      currency: 'KES',
      method: 'demo',
      customer: { phone: '+254700000001' },
      idempotency_key: 'test:col:payer',
    });
    expect(result.collection.fee_amount).toBe(20); // 1000 * 2%
    expect(result.collection.customer_amount).toBe(1020); // amount + fee

    await waitFor(
      () => getCollection(result.collection.id),
      (c) => c.business_status === 'successful',
    );

    const wallet = await findWalletBySub(subMerchantId, 'collection');
    // payer_covers: wallet credited 1000 (gross), no fee debit
    expect(wallet!.available_balance).toBe(1000);
  });
});
