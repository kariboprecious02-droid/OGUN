/**
 * Ledger reconciliation integration tests — §3.5 / §13.4.
 *
 * Proves that:
 *   - A clean wallet with consistent ledger entries reports no drift.
 *   - Tampering with the stored balance (simulating a corrupt write)
 *     is detected and recorded in `ledger_drift_events`.
 *   - The reconciler never auto-corrects — drift requires manual ops
 *     review.
 */

import {
  describeIntegration,
  setupIntegrationSchema,
  truncateAllTables,
  teardownIntegration,
} from '@/test/integration.setup';
import { createActiveMerchantFixture, TestMerchant } from '@/test/fixtures';
import { getPool } from '@/infra/db/pool';
import { topupPayoutWallet } from './wallet.service';
import { findWalletBySub } from './wallet.repository';
import { reconcileAllWallets } from './reconciliation';

describeIntegration('ledger reconciliation (integration)', () => {
  let fixture: TestMerchant;

  beforeAll(async () => {
    await setupIntegrationSchema();
  });

  afterAll(async () => {
    await teardownIntegration();
  });

  beforeEach(async () => {
    await truncateAllTables();
    fixture = await createActiveMerchantFixture({ payoutTopup: 100_000 });
  });

  test('clean wallet has no drift', async () => {
    const report = await reconcileAllWallets();
    expect(report.total_wallets).toBeGreaterThanOrEqual(2);
    expect(report.wallets_with_drift).toBe(0);
    expect(report.drift).toEqual([]);
  });

  test('stored balance tampering is detected and logged', async () => {
    // Simulate corruption: directly mutate the stored available_balance.
    const wallet = await findWalletBySub(fixture.subMerchantId, 'payout');
    await getPool().query(
      `UPDATE wallets SET available_balance = available_balance + 50000 WHERE id = $1`,
      [wallet!.id],
    );

    const report = await reconcileAllWallets();
    expect(report.wallets_with_drift).toBe(1);
    const d = report.drift[0];
    expect(d.wallet_id).toBe(wallet!.id);
    expect(d.available_delta).toBe(50000); // stored - derived
    expect(d.derived_available).toBe(100000); // true value from ledger
    expect(d.stored_available).toBe(150000); // tampered value

    // Drift event is persisted
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ledger_drift_events WHERE wallet_id = $1`,
      [wallet!.id],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  test('reconciliation does not auto-correct drift', async () => {
    const wallet = await findWalletBySub(fixture.subMerchantId, 'payout');
    await getPool().query(
      `UPDATE wallets SET available_balance = available_balance - 1 WHERE id = $1`,
      [wallet!.id],
    );
    await reconcileAllWallets();
    // Balance stays as-is; reconciler is read-only
    const after = await findWalletBySub(fixture.subMerchantId, 'payout');
    expect(after!.available_balance).toBe(99999);
  });

  test('subsequent ledger posts pair correctly with stored balance after reconciliation runs', async () => {
    // A clean reconciliation shouldn't disturb the ledger; verify by
    // running a top-up after a reconciliation pass.
    await reconcileAllWallets();
    const before = await findWalletBySub(fixture.subMerchantId, 'payout');
    expect(before!.available_balance).toBe(100_000);

    await topupPayoutWallet({
      merchantId: fixture.merchantId,
      subMerchantId: fixture.subMerchantId,
      amount: 25_000,
      reference: 'after-recon',
      idempotencyKey: 'recon:topup:1',
    });
    const after = await findWalletBySub(fixture.subMerchantId, 'payout');
    expect(after!.available_balance).toBe(125_000);

    const report = await reconcileAllWallets();
    expect(report.wallets_with_drift).toBe(0);
  });
});
