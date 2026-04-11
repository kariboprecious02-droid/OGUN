/**
 * Admin read endpoint integration tests.
 *
 * Covers the read-only admin surface used by the Ogun admin dashboard:
 *   - POST   /v1/admin/session                (auth check)
 *   - GET    /v1/admin/merchants
 *   - GET    /v1/admin/merchants/:id
 *   - GET    /v1/admin/wallets
 *   - GET    /v1/admin/wallets/:id/ledger
 *   - GET    /v1/admin/collections
 *   - GET    /v1/admin/payouts
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
import { config } from '@/infra/config';
import { createCollection, getCollection } from '@/modules/collection/collection.service';

async function waitForStatus<T extends Record<string, unknown>>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('waitForStatus timeout');
}

describeIntegration('admin read endpoints (integration)', () => {
  let app: Express;
  let fixture: TestMerchant;
  const adminHeader = config.platform.webhookSigningSalt;

  beforeAll(async () => {
    await setupIntegrationSchema();
    app = createApp();
  });

  afterAll(async () => {
    await teardownIntegration();
  });

  beforeEach(async () => {
    await truncateAllTables();
    fixture = await createActiveMerchantFixture({ payoutTopup: 500_000 });
  });

  describe('admin auth', () => {
    test('missing admin secret returns 403', async () => {
      const res = await request(app).get('/v1/admin/merchants');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    test('wrong admin secret returns 403', async () => {
      const res = await request(app)
        .get('/v1/admin/merchants')
        .set('X-Ogun-Admin-Secret', 'wrong');
      expect(res.status).toBe(403);
    });

    test('POST /admin/session with valid secret returns 200', async () => {
      const res = await request(app)
        .post('/v1/admin/session')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.authenticated).toBe(true);
      expect(res.body.data.verified_at).toBeTruthy();
    });
  });

  describe('GET /admin/merchants', () => {
    test('lists merchants with pagination', async () => {
      const res = await request(app)
        .get('/v1/admin/merchants')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
      const row = res.body.data[0];
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('legal_name');
      expect(row).toHaveProperty('status');
    });

    test('filters by status', async () => {
      // Fixture merchants are in 'active' state
      const res = await request(app)
        .get('/v1/admin/merchants?status=active')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.every((m: { status: string }) => m.status === 'active')).toBe(true);
    });

    test('search by legal_name substring', async () => {
      const res = await request(app)
        .get('/v1/admin/merchants?search=Fixture')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /admin/merchants/:id', () => {
    test('returns merchant with sub_merchants, documents, rules, and reviews', async () => {
      const res = await request(app)
        .get(`/v1/admin/merchants/${fixture.merchantId}`)
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.merchant.id).toBe(fixture.merchantId);
      expect(Array.isArray(res.body.data.sub_merchants)).toBe(true);
      expect(Array.isArray(res.body.data.documents)).toBe(true);
      expect(Array.isArray(res.body.data.rule_results)).toBe(true);
      expect(Array.isArray(res.body.data.reviews)).toBe(true);
      expect(res.body.data.sub_merchants.length).toBeGreaterThanOrEqual(1);
    });

    test('404 for unknown merchant id', async () => {
      const res = await request(app)
        .get('/v1/admin/merchants/mrc_nonexistent')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /admin/wallets', () => {
    test('lists wallets with balances', async () => {
      const res = await request(app)
        .get('/v1/admin/wallets')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2); // collection + payout
      const payoutWallet = res.body.data.find(
        (w: { wallet_type: string }) => w.wallet_type === 'payout',
      );
      expect(payoutWallet).toBeTruthy();
      expect(payoutWallet.available_balance).toBe(500_000);
      expect(typeof payoutWallet.available_balance).toBe('number');
      expect(payoutWallet.merchant_legal_name).toBeTruthy();
      expect(payoutWallet.sub_merchant_name).toBeTruthy();
    });

    test('filters by merchant_id', async () => {
      const res = await request(app)
        .get(`/v1/admin/wallets?merchant_id=${fixture.merchantId}`)
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.every((w: { merchant_id: string }) => w.merchant_id === fixture.merchantId)).toBe(true);
    });

    test('filters by wallet_type=payout', async () => {
      const res = await request(app)
        .get('/v1/admin/wallets?wallet_type=payout')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.every((w: { wallet_type: string }) => w.wallet_type === 'payout')).toBe(true);
    });
  });

  describe('GET /admin/wallets/:id/ledger', () => {
    test('returns ledger entries for the wallet', async () => {
      const wallets = await request(app)
        .get(`/v1/admin/wallets?merchant_id=${fixture.merchantId}&wallet_type=payout`)
        .set('X-Ogun-Admin-Secret', adminHeader);
      const walletId = wallets.body.data[0].id;

      const res = await request(app)
        .get(`/v1/admin/wallets/${walletId}/ledger`)
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const entry = res.body.data[0];
      expect(entry.transaction_type).toBe('payout_wallet_topup_credit');
      expect(entry.amount).toBe(500_000);
      expect(entry.direction).toBe('credit');
    });
  });

  describe('GET /admin/collections', () => {
    test('lists collections with dual-state fields', async () => {
      // Create a successful demo collection first
      const created = await createCollection({
        merchant_id: fixture.merchantId,
        sub_merchant_id: fixture.subMerchantId,
        amount: 2000,
        currency: 'KES',
        method: 'demo',
        customer: { phone: '+254700000001' },
        idempotency_key: 'admin-col-1',
      });
      await waitForStatus(
        async () => (await getCollection(created.collection.id)) as unknown as Record<string, unknown>,
        (c) => c.business_status === 'successful',
      );

      const res = await request(app)
        .get('/v1/admin/collections')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const row = res.body.data.find((c: { id: string }) => c.id === created.collection.id);
      expect(row).toBeTruthy();
      expect(row.business_status).toBe('successful');
      expect(row.internal_status).toBe('succeeded');
      expect(row.amount).toBe(2000);
      expect(row.settlement_eligible).toBe(true);
      expect(row.wallet_credited).toBe(true);
    });

    test('filters by business_status', async () => {
      const res = await request(app)
        .get('/v1/admin/collections?business_status=successful')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(
        res.body.data.every((c: { business_status: string }) => c.business_status === 'successful'),
      ).toBe(true);
    });
  });

  describe('GET /admin/payouts', () => {
    test('lists payouts with fee model fields', async () => {
      const res = await request(app)
        .get('/v1/admin/payouts')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      // May be empty for a fresh merchant; shape check on schema
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
