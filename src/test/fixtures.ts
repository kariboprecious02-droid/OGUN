/**
 * Shared fixtures for integration tests — creates an active merchant
 * with a funded payout wallet, matching the `seed.ts` shape but without
 * the CLI noise.
 */

import { newId } from '@/infra/ids';
import { query, withTransaction } from '@/infra/db/pool';
import { insertMerchant } from '@/modules/merchant/merchant.repository';
import { createWalletsForSubMerchant, topupPayoutWallet } from '@/modules/wallet/wallet.service';
import { upsertSettings } from '@/modules/merchant/settings.repository';
import { issueCredentials } from '@/modules/auth/auth.service';

export type TestMerchant = {
  merchantId: string;
  subMerchantId: string;
  credentials: Awaited<ReturnType<typeof issueCredentials>>;
};

export async function createActiveMerchantFixture(options: {
  payoutTopup?: number;
  collectionFeePct?: number;
  collectionFeeModel?: 'merchant_covers' | 'payer_covers';
  payoutFeePct?: number;
  payoutFeeModel?: 'merchant_covers' | 'recipient_covers';
  enabledMethods?: string[];
  notificationEmails?: string[];
  contactEmail?: string;
} = {}): Promise<TestMerchant> {
  // Create active merchant directly — skips the compliance pipeline
  // since we're testing collection/payout flows downstream.
  const merchant = await insertMerchant({
    id: newId('merchant'),
    legal_name: 'Fixture Co',
    trading_name: 'Fixture',
    country: 'KE',
    settlement_currency: 'KES',
    contact_email: options.contactEmail ?? 'fixture@example.com',
  });
  await query(`UPDATE merchants SET status = 'active' WHERE id = $1`, [merchant.id]);

  const subMerchantId = newId('subMerchant');
  await query(
    `INSERT INTO sub_merchants (id, merchant_id, name, status) VALUES ($1,$2,$3,'active')`,
    [subMerchantId, merchant.id, 'Fixture Branch'],
  );

  await upsertSettings({
    id: newId('merchantSettings'),
    merchant_id: merchant.id,
    sub_merchant_id: null,
    collection_fee_pct: options.collectionFeePct ?? 1.5,
    collection_fee_model: options.collectionFeeModel ?? 'merchant_covers',
    payout_fee_pct: options.payoutFeePct ?? 1.0,
    payout_fee_model: options.payoutFeeModel ?? 'merchant_covers',
    settlement_fee_pct: 0,
    enabled_methods: options.enabledMethods ?? ['mpesa', 'airtel', 'demo'],
    notification_emails: options.notificationEmails ?? [],
  });

  await withTransaction(async (client) => {
    await createWalletsForSubMerchant(client, merchant.id, subMerchantId);
  });

  if (options.payoutTopup && options.payoutTopup > 0) {
    await topupPayoutWallet({
      merchantId: merchant.id,
      subMerchantId,
      amount: options.payoutTopup,
      currency: 'KES',
      reference: 'fixture-topup',
      idempotencyKey: `fixture:topup:${merchant.id}:${subMerchantId}`,
    });
  }

  const credentials = await issueCredentials(merchant.id);

  return { merchantId: merchant.id, subMerchantId, credentials };
}
