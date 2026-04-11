/**
 * Settlement integration tests.
 *
 * Covers the full §7 path end-to-end against real Postgres + Redis:
 *   - executeSettlement debits the collection wallet via the ledger
 *   - generateAndStoreReport produces a persisted PDF + report_url
 *   - settlement → payout rail creates a payout + funds the payout wallet
 *   - email adapter receives a settlement-paid notification
 *   - GET /v1/settlements/:id/report returns the stored URL
 *
 *   npm run test:integration
 */

import request from 'supertest';
import type { Express } from 'express';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  describeIntegration,
  setupIntegrationSchema,
  truncateAllTables,
  teardownIntegration,
} from '@/test/integration.setup';
import { createActiveMerchantFixture, TestMerchant } from '@/test/fixtures';
import { createApp } from '@/api/app';
import { query, getPool } from '@/infra/db/pool';
import { createCollection, getCollection } from '@/modules/collection/collection.service';
import { createSettlement, executeSettlement } from './settlement.service';
import { renderSettlementPdf } from './report';
import { findWalletBySub } from '@/modules/wallet/wallet.repository';
import { CaptureEmailAdapter, setEmailAdapter } from '@/infra/email';

async function waitForStatus<T extends Record<string, unknown>>(
  fn: () => Promise<T | null>,
  predicate: (value: T) => boolean,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value && predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('waitForStatus timeout');
}

describeIntegration('settlement pipeline (integration, §7)', () => {
  let app: Express;
  let fixture: TestMerchant;
  let captured: CaptureEmailAdapter;

  beforeAll(async () => {
    await setupIntegrationSchema();
    app = createApp();
  });

  afterAll(async () => {
    await teardownIntegration();
    setEmailAdapter(null);
    try {
      await fsp.rm(path.resolve(process.cwd(), '.ogun-storage'), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore
    }
  });

  beforeEach(async () => {
    await truncateAllTables();
    fixture = await createActiveMerchantFixture({ payoutTopup: 0 });
    // Attach a settlement destination to the sub-merchant so the
    // settlement → payout rail has somewhere to send funds.
    await query(
      `UPDATE sub_merchants
          SET settlement_destination = $2::jsonb
        WHERE id = $1`,
      [
        fixture.subMerchantId,
        JSON.stringify({
          beneficiary_name: 'Kwara Kenya Settlement Account',
          bank_code: 'EQTY',
          account_number: '0112233445',
        }),
      ],
    );

    // Wire a capture email adapter so we can assert on emitted mail.
    captured = new CaptureEmailAdapter();
    setEmailAdapter(captured);
  });

  /**
   * Create N successful collections against the fixture merchant so
   * there's something to settle. Waits for demo connector to resolve.
   */
  async function createSuccessfulCollections(count: number, amount = 1000): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const result = await createCollection({
        merchant_id: fixture.merchantId,
        sub_merchant_id: fixture.subMerchantId,
        amount,
        currency: 'KES',
        method: 'demo',
        customer: { phone: '+254700000001' },
        idempotency_key: `settle-col-${i}-${Date.now()}`,
      });
      ids.push(result.collection.id);
    }
    // Wait for all to reach 'successful'
    for (const id of ids) {
      await waitForStatus(
        async () => {
          const row = await getCollection(id);
          return row as unknown as Record<string, unknown>;
        },
        (c) => c.business_status === 'successful',
      );
    }
    return ids;
  }

  test('renderSettlementPdf produces a non-trivial PDF buffer', async () => {
    await createSuccessfulCollections(2, 1000);
    const batch = await createSettlement({
      merchantId: fixture.merchantId,
      subMerchantId: fixture.subMerchantId,
    });
    const { buffer, filename } = await renderSettlementPdf(batch.settlement_id);
    // %PDF header and sane size
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(500);
    expect(filename).toMatch(/^settlement-stl_/);
  });

  test('executeSettlement debits the collection wallet AND credits the payout wallet via the rail', async () => {
    await createSuccessfulCollections(3, 1000); // 3 × 985 = 2955 in collection wallet
    const collectionWallet = await findWalletBySub(fixture.subMerchantId, 'collection');
    expect(collectionWallet!.available_balance).toBe(2955);

    const batch = await createSettlement({
      merchantId: fixture.merchantId,
      subMerchantId: fixture.subMerchantId,
    });
    // gross 3000, fees 45, settlement_fee 0, adjustments 0, net 2955
    expect(batch.gross).toBe(3000);
    expect(batch.fees).toBe(45);
    expect(batch.net).toBe(2955);

    const status = await executeSettlement(batch.settlement_id);
    expect(status).toBe('paid');

    // Collection wallet now 0 after settlement debit
    const afterCollection = await findWalletBySub(fixture.subMerchantId, 'collection');
    expect(afterCollection!.available_balance).toBe(0);

    // The settlement → payout rail pre-credits the payout wallet with
    // total_debit (net + fee for merchant_covers), creates a real payout
    // via the Payout Orchestrator, and links settlements.payout_id.
    const { rows } = await query<{
      payout_id: string | null;
      destination_summary: Record<string, unknown> | null;
    }>(`SELECT payout_id, destination_summary FROM settlements WHERE id = $1`, [
      batch.settlement_id,
    ]);
    const row = rows[0];
    expect(row).toBeTruthy();
    expect(row.payout_id).toMatch(/^pay_/);
    expect(row.destination_summary).toBeTruthy();
    expect(row.destination_summary!.bank_code).toBe('EQTY');

    // Payout wallet should have been topped up (net + 1% fee = 2984)
    // then reserved by the payout orchestrator (still available until
    // the demo connector resolves it). Either way, the reserved_balance
    // plus available_balance covers the rail top-up.
    const payoutWallet = await findWalletBySub(fixture.subMerchantId, 'payout');
    expect(payoutWallet!.available_balance + payoutWallet!.reserved_balance).toBeGreaterThanOrEqual(2984);
  });

  test('settlement.paid email has a PDF attachment', async () => {
    await createSuccessfulCollections(2, 1000);
    const batch = await createSettlement({
      merchantId: fixture.merchantId,
      subMerchantId: fixture.subMerchantId,
    });
    const status = await executeSettlement(batch.settlement_id);
    expect(status).toBe('paid');

    // Capture adapter should have received one settlement confirmation
    expect(captured.captured.length).toBeGreaterThanOrEqual(1);
    const msg = captured.captured.find((m) =>
      m.subject.includes('Ogun settlement'),
    );
    expect(msg).toBeTruthy();
    expect(msg!.attachments).toBeTruthy();
    expect(msg!.attachments!.length).toBe(1);
    expect(msg!.attachments![0].filename).toMatch(/\.pdf$/);
    expect(msg!.attachments![0].content.slice(0, 5).toString()).toBe('%PDF-');
  });

  test('GET /v1/settlements/:id/report returns the persisted URL', async () => {
    await createSuccessfulCollections(1, 1500);
    const batch = await createSettlement({
      merchantId: fixture.merchantId,
      subMerchantId: fixture.subMerchantId,
    });
    await executeSettlement(batch.settlement_id);

    const secretAuth = `Bearer ${fixture.credentials.sandbox.secret}`;
    const res = await request(app)
      .get(`/v1/settlements/${batch.settlement_id}/report`)
      .set('Authorization', secretAuth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.report_url).toMatch(/^file:\/\/.+\.pdf$/);
    expect(res.body.data.expires_at).toBeTruthy();
  });

  test('GET /v1/settlements/:id/report returns 404 across merchants', async () => {
    await createSuccessfulCollections(1, 500);
    const batch = await createSettlement({
      merchantId: fixture.merchantId,
      subMerchantId: fixture.subMerchantId,
    });
    await executeSettlement(batch.settlement_id);

    const other = await createActiveMerchantFixture();
    const otherAuth = `Bearer ${other.credentials.sandbox.secret}`;
    const res = await request(app)
      .get(`/v1/settlements/${batch.settlement_id}/report`)
      .set('Authorization', otherAuth);
    expect(res.status).toBe(404);
  });

  test('settlement with insufficient collection balance fails cleanly', async () => {
    // Create one successful collection, then inflate the net amount
    // by manipulating settlements directly so we can reproduce the
    // "insufficient_collection_balance" failure path.
    await createSuccessfulCollections(1, 500);
    const { rows: w } = await getPool().query<{ available_balance: string }>(
      `SELECT available_balance FROM wallets
        WHERE sub_merchant_id = $1 AND wallet_type = 'collection'`,
      [fixture.subMerchantId],
    );
    // 500 * 1.5% = 7.5 → Math.round(7.5) = 8 in JS (half-to-even), so
    // wallet credit = 500 - 8 = 492.
    expect(Number(w[0].available_balance)).toBe(492);

    const batch = await createSettlement({
      merchantId: fixture.merchantId,
      subMerchantId: fixture.subMerchantId,
    });
    // Artificially inflate the net amount so executeSettlement blows past
    // the collection wallet balance.
    await getPool().query(
      `UPDATE settlements SET net_amount = $2 WHERE id = $1`,
      [batch.settlement_id, 1_000_000_00],
    );
    const status = await executeSettlement(batch.settlement_id);
    expect(status).toBe('failed');

    // Capture adapter did NOT receive a paid confirmation email
    expect(
      captured.captured.find((m) => m.subject.includes('Ogun settlement')),
    ).toBeUndefined();
  });
});
