/**
 * Admin / management API integration tests.
 *
 * Covers the P1 route bundle added in this PR:
 *   - PATCH /v1/merchants/:id         — profile update with whitelist
 *   - PATCH /v1/sub-merchants/:id     — sub-merchant profile update
 *   - PATCH /v1/merchants/:id/settings
 *   - PATCH /v1/sub-merchants/:id/settings
 *   - GET   /v1/merchants/:id/settings — effective settings
 *   - POST  /v1/merchants/:id/api-keys/rotate
 *   - POST  /v1/merchants/:id/webhook-secret/rotate
 *   - POST  /v1/merchants/:id/documents          (multipart)
 *   - GET   /v1/merchants/:id/documents
 *   - GET   /v1/merchants/:id/documents/:id
 *   - POST  /v1/collections/:id/refund
 *   - Webhook endpoint CRUD + test delivery
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
import { findWalletBySub } from '@/modules/wallet/wallet.repository';
import { getPool } from '@/infra/db/pool';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

async function waitForStatus(
  app: Express,
  auth: string,
  path: string,
  field: 'business_status',
  target: string,
  timeoutMs = 2000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(path).set('Authorization', auth);
    if (res.status === 200) {
      const body = res.body as { data?: Record<string, unknown> };
      if ((body.data?.[field] as string) === target) return body.data ?? {};
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`waitForStatus timeout waiting for ${field}=${target}`);
}

describeIntegration('management API (integration)', () => {
  let app: Express;
  let fixture: TestMerchant;
  let draftFixture: TestMerchant; // merchant left in draft for document tests
  let secretAuth: string;

  beforeAll(async () => {
    await setupIntegrationSchema();
    app = createApp();
  });

  afterAll(async () => {
    await teardownIntegration();
    // Clean up local document storage tree
    try {
      await fsp.rm(path.resolve(process.cwd(), '.ogun-storage'), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    await truncateAllTables();
    fixture = await createActiveMerchantFixture({ payoutTopup: 1_000_000 });
    secretAuth = `Bearer ${fixture.credentials.sandbox.secret}`;
    // A separate merchant row kept in draft so document upload can run
    // (document uploads are blocked once a merchant goes active).
    draftFixture = await createActiveMerchantFixture();
    await getPool().query(`UPDATE merchants SET status = 'draft' WHERE id = $1`, [
      draftFixture.merchantId,
    ]);
  });

  describe('PATCH /merchants/:id', () => {
    test('updates whitelisted profile fields', async () => {
      const res = await request(app)
        .patch(`/v1/merchants/${fixture.merchantId}`)
        .set('Authorization', secretAuth)
        .send({
          trading_name: 'Fixture Trading Updated',
          website_url: 'https://example.com',
        });
      expect(res.status).toBe(200);
      expect(res.body.data.trading_name).toBe('Fixture Trading Updated');
      expect(res.body.data.website_url).toBe('https://example.com');
    });

    test('rejects unknown fields with 400', async () => {
      const res = await request(app)
        .patch(`/v1/merchants/${fixture.merchantId}`)
        .set('Authorization', secretAuth)
        .send({ status: 'active' }); // not whitelisted
      expect(res.status).toBe(400);
    });

    test('cross-merchant access returns 404', async () => {
      const other = await createActiveMerchantFixture();
      const otherAuth = `Bearer ${other.credentials.sandbox.secret}`;
      const res = await request(app)
        .patch(`/v1/merchants/${fixture.merchantId}`)
        .set('Authorization', otherAuth)
        .send({ trading_name: 'Should Not Work' });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /sub-merchants/:id', () => {
    test('updates sub-merchant profile', async () => {
      const res = await request(app)
        .patch(`/v1/sub-merchants/${fixture.subMerchantId}`)
        .set('Authorization', secretAuth)
        .send({ name: 'Fixture Nairobi Branch', settlement_preference: 'daily' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Fixture Nairobi Branch');
      expect(res.body.data.settlement_preference).toBe('daily');
    });
  });

  describe('merchant settings', () => {
    test('PATCH merchant settings then GET returns updated values', async () => {
      const patch = await request(app)
        .patch(`/v1/merchants/${fixture.merchantId}/settings`)
        .set('Authorization', secretAuth)
        .send({
          collection_fee_pct: 2.0,
          collection_fee_model: 'payer_covers',
          payout_fee_pct: 0.75,
        });
      expect(patch.status).toBe(200);
      expect(patch.body.data.collection_fee_pct).toBe(2);
      expect(patch.body.data.collection_fee_model).toBe('payer_covers');

      const get = await request(app)
        .get(`/v1/merchants/${fixture.merchantId}/settings`)
        .set('Authorization', secretAuth);
      expect(get.status).toBe(200);
      expect(get.body.data.collection_fee_pct).toBe(2);
      expect(get.body.data.payout_fee_pct).toBe(0.75);
    });

    test('sub-merchant settings override merchant-level', async () => {
      // Merchant-level
      await request(app)
        .patch(`/v1/merchants/${fixture.merchantId}/settings`)
        .set('Authorization', secretAuth)
        .send({ collection_fee_pct: 1.5 })
        .expect(200);

      // Sub override
      const subPatch = await request(app)
        .patch(`/v1/sub-merchants/${fixture.subMerchantId}/settings`)
        .set('Authorization', secretAuth)
        .send({ collection_fee_pct: 3.0, collection_fee_model: 'payer_covers' });
      expect(subPatch.status).toBe(200);
      expect(subPatch.body.data.source).toBe('sub_merchant');
      expect(subPatch.body.data.collection_fee_pct).toBe(3);
    });
  });

  describe('key rotation', () => {
    test('rotates secret key; old key stops working, new key works', async () => {
      const rotate = await request(app)
        .post(`/v1/merchants/${fixture.merchantId}/api-keys/rotate`)
        .set('Authorization', secretAuth)
        .send({ environment: 'sandbox' });
      expect(rotate.status).toBe(200);
      const newSecret = rotate.body.data.secret_key as string;
      expect(newSecret).toMatch(/^sk_test_/);

      // Old secret should now fail
      const oldFails = await request(app)
        .get('/v1/wallets')
        .set('Authorization', secretAuth);
      expect(oldFails.status).toBe(401);

      // New secret works
      const newWorks = await request(app)
        .get('/v1/wallets')
        .set('Authorization', `Bearer ${newSecret}`);
      expect(newWorks.status).toBe(200);
    });

    test('rotates webhook secret', async () => {
      const res = await request(app)
        .post(`/v1/merchants/${fixture.merchantId}/webhook-secret/rotate`)
        .set('Authorization', secretAuth)
        .send({ environment: 'sandbox' });
      expect(res.status).toBe(200);
      expect(res.body.data.webhook_secret).toMatch(/^whsec_test_/);
    });
  });

  describe('document upload', () => {
    const draftAuth = () => `Bearer ${draftFixture.credentials.sandbox.secret}`;

    test('uploads a PDF and records SHA-256 hash', async () => {
      const res = await request(app)
        .post(`/v1/merchants/${draftFixture.merchantId}/documents`)
        .set('Authorization', draftAuth())
        .field('type', 'certificate_of_registration')
        .attach('file', Buffer.from('%PDF-1.4 fake content'), 'cor.pdf');
      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('certificate_of_registration');
      expect(res.body.data.file_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.data.review_status).toBe('pending');
    });

    test('rejects unknown document type with 400', async () => {
      const res = await request(app)
        .post(`/v1/merchants/${draftFixture.merchantId}/documents`)
        .set('Authorization', draftAuth())
        .field('type', 'not_a_real_type')
        .attach('file', Buffer.from('x'), 'x.pdf');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    test('rejects upload when merchant is active', async () => {
      // Active merchant from the main fixture
      const res = await request(app)
        .post(`/v1/merchants/${fixture.merchantId}/documents`)
        .set('Authorization', secretAuth)
        .field('type', 'tax_certificate')
        .attach('file', Buffer.from('x'), 'x.pdf');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Cannot upload documents while merchant is in state/);
    });

    test('lists uploaded documents for the merchant', async () => {
      await request(app)
        .post(`/v1/merchants/${draftFixture.merchantId}/documents`)
        .set('Authorization', draftAuth())
        .field('type', 'bank_confirmation')
        .attach('file', Buffer.from('bank'), 'bank.pdf')
        .expect(201);
      const list = await request(app)
        .get(`/v1/merchants/${draftFixture.merchantId}/documents`)
        .set('Authorization', draftAuth());
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThanOrEqual(1);
      expect(list.body.data[0].file_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('collection refund (§5.8)', () => {
    async function createSuccessfulCollection(idemKey: string, amount = 1000) {
      const created = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', idemKey)
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000001' },
        })
        .expect(201);
      const colId = created.body.data.id as string;
      await waitForStatus(app, secretAuth, `/v1/collections/${colId}`, 'business_status', 'successful');
      return colId;
    }

    test('full refund of unsettled collection flips business_status and debits wallet', async () => {
      const colId = await createSuccessfulCollection('refund-full');

      // merchant_covers: wallet got 1000 credit - 15 fee = 985
      const beforeWallet = await findWalletBySub(fixture.subMerchantId, 'collection');
      expect(beforeWallet!.available_balance).toBe(985);

      const res = await request(app)
        .post(`/v1/collections/${colId}/refund`)
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'refund-full-key')
        .send({ amount: 1000, reason: 'customer requested' });
      expect(res.status).toBe(200);
      expect(res.body.data.business_status).toBe('refunded');
      expect(res.body.data.refund_status).toBe('refunded');
      expect(res.body.data.refunded_amount).toBe(1000);

      // Wallet: 985 - 1000 = -15 (pre-settlement refund uses manual_adjustment)
      const afterWallet = await findWalletBySub(fixture.subMerchantId, 'collection');
      expect(afterWallet!.available_balance).toBe(-15);
    });

    test('partial refund keeps business_status=successful, sets refund_status=partial_refund', async () => {
      const colId = await createSuccessfulCollection('refund-partial');

      const res = await request(app)
        .post(`/v1/collections/${colId}/refund`)
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'refund-partial-key')
        .send({ amount: 300 });
      expect(res.status).toBe(200);
      expect(res.body.data.business_status).toBe('successful');
      expect(res.body.data.refund_status).toBe('partial_refund');
      expect(res.body.data.refunded_amount).toBe(300);
    });

    test('overshooting the refund amount fails with 400', async () => {
      const colId = await createSuccessfulCollection('refund-overshoot');
      const res = await request(app)
        .post(`/v1/collections/${colId}/refund`)
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'refund-overshoot-key')
        .send({ amount: 99_999 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    test('refunding a non-successful collection fails', async () => {
      // Demo 004 resolves to failed
      const created = await request(app)
        .post('/v1/collections')
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'refund-failed-col')
        .send({
          merchant_id: fixture.merchantId,
          sub_merchant_id: fixture.subMerchantId,
          amount: 500,
          currency: 'KES',
          method: 'demo',
          customer: { phone: '+254700000004' },
        })
        .expect(201);
      await waitForStatus(
        app,
        secretAuth,
        `/v1/collections/${created.body.data.id}`,
        'business_status',
        'failed',
      );
      const res = await request(app)
        .post(`/v1/collections/${created.body.data.id}/refund`)
        .set('Authorization', secretAuth)
        .set('Idempotency-Key', 'refund-failed-attempt')
        .send({ amount: 500 });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Only successful collections/);
    });
  });

  describe('webhook endpoint CRUD', () => {
    test('full create → list → get → update → delete flow', async () => {
      const create = await request(app)
        .post('/v1/webhook-endpoints')
        .set('Authorization', secretAuth)
        .send({
          url: 'https://merchant.example.com/ogun',
          subscribed_events: ['collection.succeeded', 'collection.failed'],
        });
      expect(create.status).toBe(201);
      const id = create.body.data.id as string;
      expect(id).toMatch(/^wep_/);
      expect(create.body.data.webhook_secret).toMatch(/^whsec_test_/);

      const list = await request(app)
        .get('/v1/webhook-endpoints')
        .set('Authorization', secretAuth);
      expect(list.status).toBe(200);
      expect(list.body.data.find((e: { id: string }) => e.id === id)).toBeTruthy();
      // Secret is NOT leaked in subsequent reads
      expect(list.body.data[0]).not.toHaveProperty('webhook_secret');

      const detail = await request(app)
        .get(`/v1/webhook-endpoints/${id}`)
        .set('Authorization', secretAuth);
      expect(detail.status).toBe(200);
      expect(detail.body.data.id).toBe(id);

      const update = await request(app)
        .put(`/v1/webhook-endpoints/${id}`)
        .set('Authorization', secretAuth)
        .send({
          is_active: false,
          subscribed_events: ['collection.succeeded'],
        });
      expect(update.status).toBe(200);
      expect(update.body.data.is_active).toBe(false);
      expect(update.body.data.subscribed_events).toEqual(['collection.succeeded']);

      await request(app)
        .delete(`/v1/webhook-endpoints/${id}`)
        .set('Authorization', secretAuth)
        .expect(204);

      const after = await request(app)
        .get(`/v1/webhook-endpoints/${id}`)
        .set('Authorization', secretAuth);
      expect(after.status).toBe(404);
    });

    test('POST /webhook-endpoints/:id/test queues a delivery', async () => {
      const create = await request(app)
        .post('/v1/webhook-endpoints')
        .set('Authorization', secretAuth)
        .send({
          url: 'https://merchant.example.com/ogun',
          subscribed_events: ['merchant.activated'],
        })
        .expect(201);
      const id = create.body.data.id as string;

      const res = await request(app)
        .post(`/v1/webhook-endpoints/${id}/test`)
        .set('Authorization', secretAuth);
      expect(res.status).toBe(202);
      expect(res.body.data.queued).toBe(true);

      // Verify a webhook_deliveries row was created for this endpoint
      const pool = getPool();
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM webhook_deliveries
          WHERE webhook_endpoint_id = $1`,
        [id],
      );
      expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
    });

    test('cross-merchant access returns 404', async () => {
      const create = await request(app)
        .post('/v1/webhook-endpoints')
        .set('Authorization', secretAuth)
        .send({
          url: 'https://a.example.com/ogun',
          subscribed_events: ['collection.succeeded'],
        })
        .expect(201);
      const id = create.body.data.id as string;

      const other = await createActiveMerchantFixture();
      const otherAuth = `Bearer ${other.credentials.sandbox.secret}`;
      const res = await request(app)
        .get(`/v1/webhook-endpoints/${id}`)
        .set('Authorization', otherAuth);
      expect(res.status).toBe(404);
    });
  });
});
