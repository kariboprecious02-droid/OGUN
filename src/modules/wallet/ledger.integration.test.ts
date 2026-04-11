/**
 * Integration tests for the immutable ledger.
 *
 * Verifies the §3.5 wallet invariant end-to-end against real Postgres:
 *   available_balance = Σ posted (non-reserved) ledger entries
 *   reserved_balance  = Σ payout_reserve − payout_release − payout_*_debit
 *
 * Also proves the idempotency_key uniqueness constraint (§2.4) —
 * posting the same entry twice is a silent no-op.
 *
 *   npm run test:integration
 */

import {
  describeIntegration,
  setupIntegrationSchema,
  truncateAllTables,
  teardownIntegration,
} from '@/test/integration.setup';
import { withTransaction } from '@/infra/db/pool';
import { newId } from '@/infra/ids';
import { insertMerchant } from '@/modules/merchant/merchant.repository';
import {
  createWalletsForSubMerchant,
  topupPayoutWallet,
} from './wallet.service';
import { findWalletBySub } from './wallet.repository';
import { postLedgerEntry, deriveWalletBalance } from './ledger';
import { LedgerTxType } from './wallet.types';
import { query } from '@/infra/db/pool';

describeIntegration('ledger + wallet (integration, §3.5)', () => {
  let merchantId: string;
  let subMerchantId: string;
  let collectionWalletId: string;
  let payoutWalletId: string;

  beforeAll(async () => {
    await setupIntegrationSchema();
  });

  afterAll(async () => {
    await teardownIntegration();
  });

  beforeEach(async () => {
    await truncateAllTables();

    // Fresh merchant + sub-merchant with both wallets
    const merchant = await insertMerchant({
      id: newId('merchant'),
      legal_name: 'Test Co',
      trading_name: 'Test',
      country: 'KE',
      settlement_currency: 'KES',
    });
    merchantId = merchant.id;
    subMerchantId = newId('subMerchant');
    await query(
      `INSERT INTO sub_merchants (id, merchant_id, name, status) VALUES ($1,$2,$3,'active')`,
      [subMerchantId, merchantId, 'Test Branch'],
    );
    await withTransaction(async (client) => {
      await createWalletsForSubMerchant(client, merchantId, subMerchantId);
    });
    collectionWalletId = (await findWalletBySub(subMerchantId, 'collection'))!.id;
    payoutWalletId = (await findWalletBySub(subMerchantId, 'payout'))!.id;
  });

  test('topup credits the payout wallet and is reflected in available_balance', async () => {
    const result = await topupPayoutWallet({
      merchantId,
      subMerchantId,
      amount: 1_000_000,
      reference: 'test-topup-1',
      idempotencyKey: 'it:topup:1',
    });
    expect(result.available_balance).toBe(1_000_000);

    const { available, reserved } = await deriveWalletBalance(payoutWalletId);
    expect(available).toBe(1_000_000);
    expect(reserved).toBe(0);
  });

  test('duplicate topup with same idempotency_key is a silent no-op', async () => {
    const a = await topupPayoutWallet({
      merchantId,
      subMerchantId,
      amount: 500,
      reference: 'test-topup-2',
      idempotencyKey: 'it:topup:2',
    });
    const b = await topupPayoutWallet({
      merchantId,
      subMerchantId,
      amount: 500,
      reference: 'test-topup-2',
      idempotencyKey: 'it:topup:2',
    });
    expect(a.available_balance).toBe(500);
    expect(b.available_balance).toBe(500); // NOT 1000
  });

  test('successful collection credit + fee debit satisfies the invariant', async () => {
    // Merchant_covers model: amount=1000, fee=15 -> wallet credit 985
    const colId = newId('collection');
    await withTransaction(async (client) => {
      await postLedgerEntry(client, {
        merchantId,
        subMerchantId,
        walletId: collectionWalletId,
        walletType: 'collection',
        transactionType: LedgerTxType.CollectionCredit,
        direction: 'credit',
        amount: 985,
        currency: 'KES',
        referenceType: 'collection',
        referenceId: colId,
        idempotencyKey: `collection_credit:${colId}`,
      });
      await postLedgerEntry(client, {
        merchantId,
        subMerchantId,
        walletId: collectionWalletId,
        walletType: 'collection',
        transactionType: LedgerTxType.CollectionFeeDebit,
        direction: 'debit',
        amount: 15,
        currency: 'KES',
        referenceType: 'collection',
        referenceId: colId,
        idempotencyKey: `collection_fee_debit:${colId}`,
      });
    });

    const stored = await findWalletBySub(subMerchantId, 'collection');
    expect(stored!.available_balance).toBe(970); // 985 credit - 15 debit

    const derived = await deriveWalletBalance(collectionWalletId);
    expect(derived.available).toBe(970);
  });

  test('payout reservation flow: reserve → finalize (merchant_covers)', async () => {
    await topupPayoutWallet({
      merchantId,
      subMerchantId,
      amount: 10_000,
      reference: 'pre-payout',
      idempotencyKey: 'it:topup:reserve-test',
    });

    const payoutId = newId('payout');
    // Merchant_covers: total_debit = 1100 (amount 1000 + fee 100)
    await withTransaction(async (client) => {
      await postLedgerEntry(client, {
        merchantId,
        subMerchantId,
        walletId: payoutWalletId,
        walletType: 'payout',
        transactionType: LedgerTxType.PayoutReserve,
        direction: 'debit',
        amount: 1100,
        currency: 'KES',
        referenceType: 'payout',
        referenceId: payoutId,
        idempotencyKey: `payout_reserve:${payoutId}`,
      });
    });

    let w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(8900);
    expect(w!.reserved_balance).toBe(1100);

    // Finalize success: principal_debit + fee_debit
    await withTransaction(async (client) => {
      await postLedgerEntry(client, {
        merchantId,
        subMerchantId,
        walletId: payoutWalletId,
        walletType: 'payout',
        transactionType: LedgerTxType.PayoutPrincipalDebit,
        direction: 'debit',
        amount: 1000,
        currency: 'KES',
        referenceType: 'payout',
        referenceId: payoutId,
        idempotencyKey: `payout_principal_debit:${payoutId}`,
      });
      await postLedgerEntry(client, {
        merchantId,
        subMerchantId,
        walletId: payoutWalletId,
        walletType: 'payout',
        transactionType: LedgerTxType.PayoutFeeDebit,
        direction: 'debit',
        amount: 100,
        currency: 'KES',
        referenceType: 'payout',
        referenceId: payoutId,
        idempotencyKey: `payout_fee_debit:${payoutId}`,
      });
    });

    w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(8900);
    expect(w!.reserved_balance).toBe(0);

    // Derived balance matches stored
    const derived = await deriveWalletBalance(payoutWalletId);
    expect(derived.available).toBe(8900);
    expect(derived.reserved).toBe(0);
  });

  test('failed payout: reserve then release restores full available', async () => {
    await topupPayoutWallet({
      merchantId,
      subMerchantId,
      amount: 5000,
      reference: 'pre-failed',
      idempotencyKey: 'it:topup:failed-test',
    });

    const payoutId = newId('payout');
    await withTransaction(async (client) => {
      await postLedgerEntry(client, {
        merchantId,
        subMerchantId,
        walletId: payoutWalletId,
        walletType: 'payout',
        transactionType: LedgerTxType.PayoutReserve,
        direction: 'debit',
        amount: 1100,
        currency: 'KES',
        referenceType: 'payout',
        referenceId: payoutId,
        idempotencyKey: `payout_reserve:${payoutId}`,
      });
    });

    let w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(3900);
    expect(w!.reserved_balance).toBe(1100);

    // Simulate Paystack failure — release full reserved
    await withTransaction(async (client) => {
      await postLedgerEntry(client, {
        merchantId,
        subMerchantId,
        walletId: payoutWalletId,
        walletType: 'payout',
        transactionType: LedgerTxType.PayoutRelease,
        direction: 'credit',
        amount: 1100,
        currency: 'KES',
        referenceType: 'payout',
        referenceId: payoutId,
        idempotencyKey: `payout_release:${payoutId}`,
      });
    });

    w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(5000);
    expect(w!.reserved_balance).toBe(0);
  });

  test('duplicate ledger post (same idempotency_key) does not double-move funds', async () => {
    const payoutId = newId('payout');
    await topupPayoutWallet({
      merchantId,
      subMerchantId,
      amount: 5000,
      reference: 'pre-dup',
      idempotencyKey: 'it:topup:dup',
    });

    await withTransaction(async (client) => {
      const first = await postLedgerEntry(client, {
        merchantId,
        subMerchantId,
        walletId: payoutWalletId,
        walletType: 'payout',
        transactionType: LedgerTxType.PayoutReserve,
        direction: 'debit',
        amount: 500,
        currency: 'KES',
        referenceType: 'payout',
        referenceId: payoutId,
        idempotencyKey: `dup_key`,
      });
      const second = await postLedgerEntry(client, {
        merchantId,
        subMerchantId,
        walletId: payoutWalletId,
        walletType: 'payout',
        transactionType: LedgerTxType.PayoutReserve,
        direction: 'debit',
        amount: 500,
        currency: 'KES',
        referenceType: 'payout',
        referenceId: payoutId,
        idempotencyKey: `dup_key`,
      });
      expect(first).toBe(true);
      expect(second).toBe(false); // duplicate no-op
    });

    const w = await findWalletBySub(subMerchantId, 'payout');
    expect(w!.available_balance).toBe(4500); // Only one reserve applied
    expect(w!.reserved_balance).toBe(500);
  });
});
