/**
 * End-to-end payout smoke tests.
 *
 * Exercises the Payout Orchestrator's reservation flow against real
 * Postgres + Redis using the Demo connector:
 *   - merchant_covers: total_debit = amount + fee
 *   - recipient_covers: total_debit = amount, recipient_amount = amount - fee
 *   - Insufficient balance fails pre-provider and releases nothing
 *   - Reservation → finalize on success: available unchanged, reserved cleared
 *   - Reservation → release on failure: available restored in full
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
import { createPayout, getPayout } from './payout.service';
import { findWalletBySub } from '@/modules/wallet/wallet.repository';
import { PayoutStatus } from './payout.types';
import { OgunError } from '@/infra/errors';

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

describeIntegration('payout orchestrator (integration, §6)', () => {
  beforeAll(async () => {
    await setupIntegrationSchema();
  });

  afterAll(async () => {
    await teardownIntegration();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  test('merchant_covers: total_debit = amount + fee, reserved then finalized', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture({
      payoutTopup: 10_000,
      payoutFeePct: 10.0,
      payoutFeeModel: 'merchant_covers',
    });

    const result = await createPayout({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 1000,
      currency: 'KES',
      method: 'demo',
      beneficiary: { name: 'John Doe', mobile_number: '+254700000001' },
      reference: 'vendor-001',
      idempotency_key: 'test:pay:mc',
    });

    // Fee calc
    expect(result.payout.fee_amount).toBe(100);
    expect(result.payout.total_debit).toBe(1100); // amount + fee
    expect(result.payout.recipient_amount).toBe(1000); // recipient gets full
    expect(result.payout.fee_model).toBe('merchant_covers');

    // Wallet: reserved immediately
    let w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(8900); // 10000 - 1100 reserved
    expect(w!.reserved_balance).toBe(1100);

    // Wait for demo dispatcher to finalize
    const resolved = await waitFor(
      () => getPayout(result.payout.id),
      (p) => p.status === PayoutStatus.Succeeded,
    );
    expect(resolved.status).toBe('succeeded');

    w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(8900); // Principal + fee debited from reserve
    expect(w!.reserved_balance).toBe(0);
  });

  test('recipient_covers: total_debit = amount, recipient gets amount - fee', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture({
      payoutTopup: 10_000,
      payoutFeePct: 10.0,
      payoutFeeModel: 'recipient_covers',
    });

    const result = await createPayout({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 1000,
      currency: 'KES',
      method: 'demo',
      beneficiary: { name: 'Jane', mobile_number: '+254700000001' },
      idempotency_key: 'test:pay:rc',
    });

    expect(result.payout.fee_amount).toBe(100);
    expect(result.payout.total_debit).toBe(1000); // amount only
    expect(result.payout.recipient_amount).toBe(900); // amount - fee
    expect(result.payout.fee_model).toBe('recipient_covers');

    let w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(9000);
    expect(w!.reserved_balance).toBe(1000);

    await waitFor(
      () => getPayout(result.payout.id),
      (p) => p.status === PayoutStatus.Succeeded,
    );

    w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(9000);
    expect(w!.reserved_balance).toBe(0);
  });

  test('insufficient balance fails pre-provider with no reservation', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture({
      payoutTopup: 500, // Not enough for 1000 + 100
      payoutFeePct: 10.0,
      payoutFeeModel: 'merchant_covers',
    });

    await expect(
      createPayout({
        merchant_id: merchantId,
        sub_merchant_id: subMerchantId,
        amount: 1000,
        currency: 'KES',
        method: 'demo',
        beneficiary: { name: 'Jane', mobile_number: '+254700000001' },
        idempotency_key: 'test:pay:insufficient',
      }),
    ).rejects.toBeInstanceOf(OgunError);

    // Wallet is untouched
    const w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(500);
    expect(w!.reserved_balance).toBe(0);
  });

  test('demo payout failure (phone 004): reserved released in full', async () => {
    const { merchantId, subMerchantId } = await createActiveMerchantFixture({
      payoutTopup: 10_000,
      payoutFeePct: 10.0,
      payoutFeeModel: 'merchant_covers',
    });

    const result = await createPayout({
      merchant_id: merchantId,
      sub_merchant_id: subMerchantId,
      amount: 1000,
      currency: 'KES',
      method: 'demo',
      beneficiary: { name: 'Bad Payee', mobile_number: '+254700000004' },
      idempotency_key: 'test:pay:failed',
    });

    // Initial reservation
    let w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(8900);
    expect(w!.reserved_balance).toBe(1100);

    // Demo connector with phone ending 004 returns failed
    await waitFor(
      () => getPayout(result.payout.id),
      (p) => p.status === PayoutStatus.Failed,
    );

    // Release restored the full reservation to available
    w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(10_000);
    expect(w!.reserved_balance).toBe(0);
  });
});
