/**
 * End-to-end API integration tests using supertest.
 *
 * Proves the full HTTP surface works against real Postgres + Redis:
 *   - Authentication: unauthenticated 401, wrong-key 401, valid sk_test_
 *   - Idempotency: same key+body cached, different body → 409
 *   - Collection dual-state: list shows business_status only,
 *     detail shows BOTH business_status AND internal_status
 *   - Payout fee models round-trip through the JSON envelope
 *   - Beneficiary CRUD
 *   - Sync endpoints with Redis-backed rate limiting
 *
 *   npm run test:integration
 */

import request from 'supertest';
import type { Express } from 'express';
import {
  describeIntegration,
  setupIntegrationSchema,
  truncateAllTables,
  teardownIntegration,
} from '@/test/integration.setup';
import { createActiveMerchantFixture, TestMerchant } from '@/test/fixtures';
import { createApp } from '@/api/app';

async function waitForStatus(
  app: Express,
  auth: string,
  path: string,
  field: 'business_status' | 'status',
  target: string,
  timeoutMs = 2000,
): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(path).set('Authorization', auth);
    if (res.status === 200) {
      const body = res.body as { data?: Record<string, unknown> };
      if ((body.data?.[field] as string) === target) return body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`waitForStatus timeout waiting for ${field}=${target} at ${path}`);
}

describeIntegration('API surface (integration)', () => {
  let app: Express;
  let fixture: TestMerchant;
  let secretAuth: string;
  let publishableAuth: string;

  beforeAll(async () => {
    await setupIntegrationSchema();
    app = createApp();
  });

  afterAll(async () => {
    await teardownIntegration();
  });

  beforeEach(async () => {
    await truncateAllTables();
    fixture = await createActiveMerchantFixture({ payoutTopup: 1_000_000 });
    secretAuth = `Bearer ${fixture.credentials.sandbox.secret}`;
    publishableAuth = `Bearer ${fixture.credentials.sandbox.publishable}`;
  });

  describe('authentication', () => {
    test('missing Authorization → 401', async () => {
      const res = await request(app).get('/v1/wallets');
      expect(res.status).toBe(401);
      expect(res.body.status).toBe('error');
      expect(res.body.error.code).toBe('unauthorized');
    });

    test('invalid Bearer scheme → 401', async () => {
      const res = await request(app)
        .get('/v1/wallets')
        .set('Authorization', 'Basic sk_test_whatever');
      expect(res.status).toBe(401);
    });

    test('bogus sk_test_ token → 401', async () => {
      const res = await request(app)
        .get('/v1/wallets')
        .set('Authorization', 'Bearer sk_test_deadbeef_notarealkey');
      expect(res.status).toBe(401);
    });

    test('publishable key cannot create collections (secret required)', async () => {
      const res = await request(app)
        .post('/v1/collections')
        .set('Authorization', publishableAuth)
        .set('Idempotency-Key', 'it-pk-col')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 100,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000001' },
        });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    test('valid sk_test_ token returns wallets', async () => {
      const res = await request(app).get('/v1/wallets').set('Authorization', secretAuth);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2); // collection + payout
    });
  });

  describe('idempotency', () => {
    test('POST /collections with same key+body returns cached response', async () => {
      const body = {
        merchant_id: fixture.merchantId,
        sub_merchant_id: fixture.subMerchantId,
        amount: 500,
        currency: 'KES',
        method: 'demo' as const,
        customer: { phone: '+254700000001' },
        reference: 'idem-1',
      };
      const first = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'idem-col-1')
        .send(body);
      expect(first.status).toBe(201);
      const firstId = first.body.data.id as string;

      const second = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'idem-col-1')
        .send(body);
      expect(second.status).toBe(201);
      expect(second.body.data.id).toBe(firstId); // cached
    });

    test('POST /collections with same key + different body → 409', async () => {
      await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'idem-col-conflict')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 500,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000001' },
        })
        .expect(201);

      const conflicting = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'idem-col-conflict')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 999, // different
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000001' },
        });
      expect(conflicting.status).toBe(409);
      expect(conflicting.body.error.code).toBe('idempotency_conflict');
    });

    test('POST /collections without Idempotency-Key → 400', async () => {
      const res = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 100,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000001' },
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });
  });

  describe('collection dual-state model (§5.2)', () => {
    test('list view returns business_status ONLY, detail view returns BOTH', async () => {
      // Create + let the demo connector resolve it
      const created = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'it-dual-1')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 1000,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000001' },
        })
        .expect(201);
      const colId = created.body.data.id as string;

      const resolved = (await waitForStatus(
        app,
        secretAuth,
        `/v1/collections/${colId}`,
        'business_status',
        'successful',
      )) as Record<string, unknown>;

      // Detail: both statuses
      expect(resolved.business_status).toBe('successful');
      expect(resolved.internal_status).toBe('succeeded');

      // List: business_status only, NO internal_status leaked
      const list = await request(app)
        .get('/v1/collections')
        .set('Authorization', secretAuth)
        .expect(200);
      const item = (list.body.data as Array<Record<string, unknown>>).find((c) => c.id === colId);
      expect(item).toBeTruthy();
      expect(item!.business_status).toBe('successful');
      expect(item!).not.toHaveProperty('internal_status');
    });

    test('failed collection (phone 004) shows business_status=failed + internal_status=failed', async () => {
      const created = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'it-dual-fail')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 1000,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000004' },
        })
        .expect(201);
      const detail = (await waitForStatus(
        app,
        secretAuth,
        `/v1/collections/${created.body.data.id}`,
        'business_status',
        'failed',
      )) as Record<string, unknown>;
      expect(detail.internal_status).toBe('failed');
      expect(detail.settlement_eligible).toBe(false);
      expect(detail.wallet_credited).toBe(false);
    });
  });

  describe('payout API round-trip (§6)', () => {
    test('merchant_covers: response carries total_debit and recipient_amount', async () => {
      const created = await request(app)
        .post('/v1/payouts')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'it-pay-mc')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 5000,
          currency: 'KES',
          method: 'demo',
          beneficiary: { name: 'John Vendor', mobile_number: '+254700000001' },
          reference: 'vendor-1',
        })
        .expect(201);

      expect(created.body.data.fee_amount).toBe(50); // 5000 * 1%
      expect(created.body.data.total_debit).toBe(5050); // merchant_covers
      expect(created.body.data.recipient_amount).toBe(5000);
      expect(created.body.data.fee_model).toBe('merchant_covers');

      const detail = (await waitForStatus(
        app,
        secretAuth,
        `/v1/payouts/${created.body.data.payout_id}`,
        'status',
        'succeeded',
      )) as Record<string, unknown>;
      expect(detail.status).toBe('succeeded');
      expect(detail.total_debit).toBe(5050);
    });

    test('insufficient balance returns 422 with insufficient_payout_balance', async () => {
      const res = await request(app)
        .post('/v1/payouts')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'it-pay-insuff')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 100_000_000, // way more than the 1M topup
          currency: 'KES',
          method: 'demo',
          beneficiary: { name: 'Too Big', mobile_number: '+254700000001' },
        });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('insufficient_payout_balance');
      expect(res.body.error.details).toHaveProperty('available_balance');
      expect(res.body.error.details).toHaveProperty('required');
    });
  });

  describe('beneficiary CRUD', () => {
    async function createTestBeneficiary(mobile = '+254700000001') {
      return request(app)
        .post('/v1/beneficiaries')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', `it-ben-${mobile}-${Date.now()}`)
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          name: 'Jane Recipient',
          beneficiary_type: 'mobile_money',
          mobile_number: mobile,
          currency: 'KES',
          provider: 'demo',
        });
    }

    test('create → get → list → patch → delete flow', async () => {
      const created = await createTestBeneficiary();
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;
      expect(id).toMatch(/^ben_/);
      expect(created.body.data.beneficiary_type).toBe('mobile_money');
      expect(created.body.data.name).toBe('Jane Recipient');

      const detail = await request(app)
        .get(`/v1/beneficiaries/${id}`)
        .set('Authorization', secretAuth)
        .expect(200);
      expect(detail.body.data.id).toBe(id);

      const list = await request(app)
        .get('/v1/beneficiaries')
        .set('Authorization', secretAuth)
        .expect(200);
      expect(list.body.data.find((b: { id: string }) => b.id === id)).toBeTruthy();
      expect(list.body.meta.total).toBeGreaterThanOrEqual(1);

      const patched = await request(app)
        .patch(`/v1/beneficiaries/${id}`)
        .set('Authorization', secretAuth)
        .send({ name: 'Jane Renamed' })
        .expect(200);
      expect(patched.body.data.name).toBe('Jane Renamed');

      await request(app)
        .delete(`/v1/beneficiaries/${id}`)
        .set('Authorization', secretAuth)
        .expect(204);

      const afterDelete = await request(app)
        .get(`/v1/beneficiaries/${id}`)
        .set('Authorization', secretAuth);
      expect(afterDelete.status).toBe(404);
    });

    test('invalid shape: mobile_money without mobile_number → 422', async () => {
      const res = await request(app)
        .post('/v1/beneficiaries')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'it-ben-invalid')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          name: 'Missing Phone',
          beneficiary_type: 'mobile_money',
          // no mobile_number
        });
      // Shape validation happens in the service → OgunError invalid_request (400)
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    test('ownership isolation: another merchants beneficiary returns 404', async () => {
      const created = await createTestBeneficiary();
      const id = created.body.data.id as string;

      // Spin up a second merchant + creds
      const other = await createActiveMerchantFixture();
      const otherAuth = `Bearer ${other.credentials.sandbox.secret}`;

      const res = await request(app)
        .get(`/v1/beneficiaries/${id}`)
        .set('Authorization', otherAuth);
      expect(res.status).toBe(404);
    });
  });

  describe('sync endpoints with rate limiting (§12.3 / §12.4)', () => {
    test('POST /collections/:id/sync on a resolved collection returns current detail', async () => {
      const created = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'it-sync-col')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 300,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000001' },
        })
        .expect(201);
      const colId = created.body.data.id as string;
      await waitForStatus(app, secretAuth, `/v1/collections/${colId}`, 'business_status', 'successful');

      const sync = await request(app)
        .post(`/v1/collections/${colId}/sync`)
        .set('Authorization', secretAuth);
      expect(sync.status).toBe(200);
      expect(sync.body.data.business_status).toBe('successful');
      expect(sync.body.data.internal_status).toBe('succeeded');
    });

    test('sync is rate limited to 1 call per collection per minute', async () => {
      const created = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'it-sync-rl')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 300,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000001' },
        })
        .expect(201);
      const colId = created.body.data.id as string;
      await waitForStatus(app, secretAuth, `/v1/collections/${colId}`, 'business_status', 'successful');

      const first = await request(app)
        .post(`/v1/collections/${colId}/sync`)
        .set('Authorization', secretAuth);
      expect(first.status).toBe(200);

      const second = await request(app)
        .post(`/v1/collections/${colId}/sync`)
        .set('Authorization', secretAuth);
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe('rate_limited');
      expect(second.body.error.details).toHaveProperty('retry_after_seconds');
    });

    test('sync returns 404 if collection belongs to another merchant', async () => {
      const created = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'it-sync-iso')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 300,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000001' },
        })
        .expect(201);
      const colId = created.body.data.id as string;

      const other = await createActiveMerchantFixture();
      const otherAuth = `Bearer ${other.credentials.sandbox.secret}`;

      const res = await request(app)
        .post(`/v1/collections/${colId}/sync`)
        .set('Authorization', otherAuth);
      expect(res.status).toBe(404);
    });
  });
});
