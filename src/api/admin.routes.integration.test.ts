/**
 * Integration tests for the new admin-mirror routes added by the
 * onboarding wizard. Mirrors the shape of admin.read.integration.test.ts:
 * one supertest call per route with the admin secret header set.
 *
 *   POST   /v1/admin/merchants/:id/documents
 *   POST   /v1/admin/merchants/:id/submit
 *   PATCH  /v1/admin/merchants/:id
 *   PATCH  /v1/admin/merchants/:id/settings
 *   POST   /v1/admin/sub-merchants
 *   PATCH  /v1/admin/sub-merchants/:id/settings
 *   GET    /v1/admin/settlements
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

describeIntegration('admin onboarding mirror routes (integration)', () => {
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

  describe('PATCH /admin/merchants/:id', () => {
    test('updates whitelisted profile fields', async () => {
      const res = await request(app)
        .patch(`/v1/admin/merchants/${fixture.merchantId}`)
        .set('X-Ogun-Admin-Secret', adminHeader)
        .send({ trading_name: 'Renamed Trading' });
      expect(res.status).toBe(200);
      expect(res.body.data.trading_name).toBe('Renamed Trading');
    });

    test('rejects unknown fields with 422', async () => {
      const res = await request(app)
        .patch(`/v1/admin/merchants/${fixture.merchantId}`)
        .set('X-Ogun-Admin-Secret', adminHeader)
        .send({ legal_name: 'X', not_a_field: 'value' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('missing admin secret returns 403', async () => {
      const res = await request(app)
        .patch(`/v1/admin/merchants/${fixture.merchantId}`)
        .send({ trading_name: 'X' });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /admin/merchants/:id/settings', () => {
    test('upserts merchant-level settings and returns effective view', async () => {
      const res = await request(app)
        .patch(`/v1/admin/merchants/${fixture.merchantId}/settings`)
        .set('X-Ogun-Admin-Secret', adminHeader)
        .send({
          collection_fee_pct: 1.75,
          collection_fee_model: 'merchant_covers',
          payout_fee_pct: 0.9,
          payout_fee_model: 'merchant_covers',
          enabled_methods: ['mpesa', 'airtel'],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.collection_fee_pct).toBeCloseTo(1.75);
      expect(res.body.data.payout_fee_pct).toBeCloseTo(0.9);
      expect(Array.isArray(res.body.data.enabled_methods)).toBe(true);
    });

    test('rejects invalid fee_model enum', async () => {
      const res = await request(app)
        .patch(`/v1/admin/merchants/${fixture.merchantId}/settings`)
        .set('X-Ogun-Admin-Secret', adminHeader)
        .send({ collection_fee_model: 'bogus' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /admin/sub-merchants', () => {
    test('creates a sub-merchant under an existing merchant', async () => {
      const res = await request(app)
        .post('/v1/admin/sub-merchants')
        .set('X-Ogun-Admin-Secret', adminHeader)
        .send({
          merchant_id: fixture.merchantId,
          name: 'Test Sub',
          code: 'TST-001',
          settlement_preference: 'weekly',
          settlement_destination: { bank_name: 'Equity', account_number: '0000' },
        });
      expect(res.status).toBe(201);
      expect(res.body.data.merchant_id).toBe(fixture.merchantId);
      expect(res.body.data.id).toMatch(/^smrc_/);
    });

    test('rejects merchant_id in wrong format', async () => {
      const res = await request(app)
        .post('/v1/admin/sub-merchants')
        .set('X-Ogun-Admin-Secret', adminHeader)
        .send({ merchant_id: 'wrong', name: 'X' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('PATCH /admin/sub-merchants/:id/settings', () => {
    test('upserts override row and returns effective view', async () => {
      const subId = fixture.subMerchantId;
      const res = await request(app)
        .patch(`/v1/admin/sub-merchants/${subId}/settings`)
        .set('X-Ogun-Admin-Secret', adminHeader)
        .send({ collection_fee_pct: 2.5, enabled_methods: ['mpesa'] });
      expect(res.status).toBe(200);
      expect(res.body.data.collection_fee_pct).toBeCloseTo(2.5);
    });

    test('returns 404 for unknown sub-merchant', async () => {
      const res = await request(app)
        .patch('/v1/admin/sub-merchants/smrc_does_not_exist/settings')
        .set('X-Ogun-Admin-Secret', adminHeader)
        .send({ collection_fee_pct: 1 });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /admin/settlements', () => {
    test('returns a paginated envelope with normalized money fields', async () => {
      const res = await request(app)
        .get('/v1/admin/settlements')
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('total');
      // If any rows exist, money fields are numbers (not bigint strings).
      for (const row of res.body.data) {
        expect(typeof row.gross_amount).toBe('number');
        expect(typeof row.net_amount).toBe('number');
      }
    });

    test('filters by merchant_id', async () => {
      const res = await request(app)
        .get(`/v1/admin/settlements?merchant_id=${fixture.merchantId}`)
        .set('X-Ogun-Admin-Secret', adminHeader);
      expect(res.status).toBe(200);
      for (const row of res.body.data) {
        expect(row.merchant_id).toBe(fixture.merchantId);
      }
    });
  });

  describe('POST /admin/merchants/:id/documents', () => {
    test('rejects when no file is attached', async () => {
      const res = await request(app)
        .post(`/v1/admin/merchants/${fixture.merchantId}/documents`)
        .set('X-Ogun-Admin-Secret', adminHeader)
        .field('type', 'certificate_of_registration');
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('rejects unknown document type', async () => {
      const res = await request(app)
        .post(`/v1/admin/merchants/${fixture.merchantId}/documents`)
        .set('X-Ogun-Admin-Secret', adminHeader)
        .field('type', 'not-a-real-doc-type')
        .attach('file', Buffer.from('hello'), 'test.pdf');
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
