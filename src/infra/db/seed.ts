/**
 * Seed script: creates the Kwara Kenya anchor merchant end-to-end and
 * prints its sandbox credentials.  Idempotent — if a merchant with the
 * same legal_name already exists and is active, we just re-print its
 * details.
 *
 *   npm run seed
 *
 * Optional env:
 *   OGUN_SEED_FUND_AMOUNT   initial payout wallet top-up in cents
 *                           (default 1_000_000_00 = KES 1,000,000)
 */

import 'dotenv/config';
import { closePool, query } from './pool';
import { logger } from '../logger';
import { newId } from '../ids';
import {
  createMerchant,
  createSubMerchant,
  transitionMerchant,
  activateMerchant,
} from '@/modules/merchant/merchant.service';
import { MerchantStatus } from '@/modules/merchant/merchant.types';
import { submitManualDecision } from '@/modules/compliance/compliance.service';
import { upsertSettings } from '@/modules/merchant/settings.repository';
import { topupPayoutWallet } from '@/modules/wallet/wallet.service';
import { closeRedis } from '../redis';

async function findExistingAnchor(): Promise<{ id: string; status: string } | null> {
  const { rows } = await query<{ id: string; status: string }>(
    `SELECT id, status FROM merchants WHERE legal_name = $1 LIMIT 1`,
    ['Kwara Kenya Ltd'],
  );
  return rows[0] ?? null;
}

async function seedRequiredDocuments(merchantId: string): Promise<void> {
  const required = [
    'certificate_of_registration',
    'tax_certificate',
    'director_id',
    'bank_confirmation',
  ];
  for (const type of required) {
    await query(
      `INSERT INTO documents
         (id, merchant_id, type, file_url, file_hash, extracted_data,
          extraction_confidence, review_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'reviewed')
       ON CONFLICT DO NOTHING`,
      [
        newId('document'),
        merchantId,
        type,
        `s3://ogun-seed/${type}.pdf`,
        '0'.repeat(64),
        JSON.stringify({
          classification: type,
          company_name: 'Kwara Kenya Ltd',
          registration_number: 'PVT-2024-12345',
          tax_id: 'P051234567A',
        }),
        95,
      ],
    );
  }
}

async function main(): Promise<void> {
  const existing = await findExistingAnchor();
  if (existing && existing.status === MerchantStatus.Active) {
    logger.info({ merchant_id: existing.id }, 'anchor merchant already active, skipping');
    return;
  }

  // 1. Create draft merchant
  const merchant = await createMerchant({
    legal_name: 'Kwara Kenya Ltd',
    trading_name: 'Kwara Kenya',
    registration_number: 'PVT-2024-12345',
    tax_id: 'P051234567A',
    country: 'KE',
    settlement_currency: 'KES',
    business_category: 'fintech',
    business_address: {
      street: '123 Moi Avenue',
      city: 'Nairobi',
      county: 'Nairobi',
      postal_code: '00100',
    },
    contact: {
      name: 'Cynthia Odhiambo',
      email: 'cynthia@kwara.co.ke',
      phone: '+254700000000',
    },
  });
  logger.info({ merchant_id: merchant.id }, 'draft merchant created');

  // 2. Create a sub-merchant (Nairobi branch)
  const sub = await createSubMerchant({
    merchant_id: merchant.id,
    name: 'Kwara Nairobi',
    code: 'KW-NBO-001',
    settlement_preference: 'weekly',
    settlement_destination: {
      bank_name: 'Equity Bank',
      account_number: '0123456789',
      branch_code: '068',
    },
  });
  logger.info({ sub_merchant_id: sub.id }, 'sub-merchant created');

  // 3. Seed settings (defaults 1.5% collection fee, 1% payout fee)
  await upsertSettings({
    id: newId('merchantSettings'),
    merchant_id: merchant.id,
    sub_merchant_id: null,
    collection_fee_pct: 1.5,
    collection_fee_model: 'merchant_covers',
    payout_fee_pct: 1.0,
    payout_fee_model: 'merchant_covers',
    settlement_fee_pct: 0,
    enabled_methods: ['mpesa', 'airtel', 'demo'],
    notification_emails: ['cynthia@kwara.co.ke'],
  });

  // 4. Upload required documents (pre-extracted so the rules engine passes)
  await seedRequiredDocuments(merchant.id);

  // 5. Walk the state machine: draft -> submitted -> under_ai_review
  //    -> under_manual_review -> approved -> credentials_issued -> active
  await transitionMerchant(merchant.id, MerchantStatus.Submitted);
  await transitionMerchant(merchant.id, MerchantStatus.UnderAiReview);
  await transitionMerchant(merchant.id, MerchantStatus.UnderManualReview);
  await submitManualDecision(
    merchant.id,
    'approve',
    'Seeded anchor merchant; auto-approved for local development.',
    'seed',
  );

  // 6. Activate — issues credentials and creates wallets for all sub-merchants
  const activation = await activateMerchant(merchant.id);

  // 7. Top up the payout wallet so devs can issue payouts immediately
  const topupAmount = Number(process.env.OGUN_SEED_FUND_AMOUNT ?? 100_000_000); // KES 1,000,000 in cents
  await topupPayoutWallet({
    merchantId: merchant.id,
    subMerchantId: sub.id,
    amount: topupAmount,
    currency: 'KES',
    reference: 'seed-initial-topup',
    idempotencyKey: `seed:topup:${merchant.id}:${sub.id}`,
  });

  // eslint-disable-next-line no-console
  console.log('\n============================================================');
  // eslint-disable-next-line no-console
  console.log('  OGUN SEED COMPLETE');
  // eslint-disable-next-line no-console
  console.log('============================================================');
  // eslint-disable-next-line no-console
  console.log(`  merchant_id      : ${merchant.id}`);
  // eslint-disable-next-line no-console
  console.log(`  sub_merchant_id  : ${sub.id}`);
  // eslint-disable-next-line no-console
  console.log(`  status           : ${activation.merchant.status}`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('  sandbox credentials (SAVE THESE — shown once):');
  // eslint-disable-next-line no-console
  console.log(`    publishable    : ${activation.credentials.sandbox.publishable}`);
  // eslint-disable-next-line no-console
  console.log(`    secret         : ${activation.credentials.sandbox.secret}`);
  // eslint-disable-next-line no-console
  console.log(`    webhook_secret : ${activation.credentials.sandbox.webhookSecret}`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`  payout wallet funded with ${topupAmount} cents (KES ${(topupAmount / 100).toLocaleString()})`);
  // eslint-disable-next-line no-console
  console.log('============================================================\n');
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    await closeRedis();
  });
