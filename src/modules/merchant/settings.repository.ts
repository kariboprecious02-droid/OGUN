import { query } from '@/infra/db/pool';

export type MerchantSettingsRow = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string | null;
  collection_fee_pct: string;
  collection_fee_model: 'merchant_covers' | 'payer_covers';
  payout_fee_pct: string;
  payout_fee_model: 'merchant_covers' | 'recipient_covers';
  settlement_fee_pct: string;
  notification_emails: string[];
  enabled_methods: string[];
  updated_at: Date;
};

/**
 * Resolve effective settings for a sub-merchant. Falls back to merchant-level
 * if no sub-merchant override exists. §3.3.
 *
 * Pass `subMerchantId=null` to fetch only merchant-level settings.
 */
export async function resolveEffectiveSettings(
  merchantId: string,
  subMerchantId: string | null,
): Promise<{
  collection_fee_pct: number;
  collection_fee_model: 'merchant_covers' | 'payer_covers';
  payout_fee_pct: number;
  payout_fee_model: 'merchant_covers' | 'recipient_covers';
  settlement_fee_pct: number;
  enabled_methods: string[];
  source: 'merchant' | 'sub_merchant';
}> {
  const { rows: subRows } = subMerchantId
    ? await query<MerchantSettingsRow>(
        `SELECT * FROM merchant_settings
          WHERE merchant_id = $1 AND sub_merchant_id = $2 LIMIT 1`,
        [merchantId, subMerchantId],
      )
    : { rows: [] as MerchantSettingsRow[] };

  if (subRows[0]) {
    return {
      collection_fee_pct: Number(subRows[0].collection_fee_pct),
      collection_fee_model: subRows[0].collection_fee_model,
      payout_fee_pct: Number(subRows[0].payout_fee_pct),
      payout_fee_model: subRows[0].payout_fee_model,
      settlement_fee_pct: Number(subRows[0].settlement_fee_pct),
      enabled_methods: subRows[0].enabled_methods,
      source: 'sub_merchant',
    };
  }

  const { rows: merchantRows } = await query<MerchantSettingsRow>(
    `SELECT * FROM merchant_settings
      WHERE merchant_id = $1 AND sub_merchant_id IS NULL LIMIT 1`,
    [merchantId],
  );
  if (merchantRows[0]) {
    return {
      collection_fee_pct: Number(merchantRows[0].collection_fee_pct),
      collection_fee_model: merchantRows[0].collection_fee_model,
      payout_fee_pct: Number(merchantRows[0].payout_fee_pct),
      payout_fee_model: merchantRows[0].payout_fee_model,
      settlement_fee_pct: Number(merchantRows[0].settlement_fee_pct),
      enabled_methods: merchantRows[0].enabled_methods,
      source: 'merchant',
    };
  }

  // Defaults — match migration defaults
  return {
    collection_fee_pct: 1.5,
    collection_fee_model: 'merchant_covers',
    payout_fee_pct: 1.0,
    payout_fee_model: 'merchant_covers',
    settlement_fee_pct: 0,
    enabled_methods: ['mpesa', 'airtel'],
    source: 'merchant',
  };
}

export async function upsertSettings(input: {
  id: string;
  merchant_id: string;
  sub_merchant_id: string | null;
  collection_fee_pct?: number;
  collection_fee_model?: 'merchant_covers' | 'payer_covers';
  payout_fee_pct?: number;
  payout_fee_model?: 'merchant_covers' | 'recipient_covers';
  settlement_fee_pct?: number;
  notification_emails?: string[];
  enabled_methods?: string[];
}): Promise<void> {
  // Two distinct unique indexes (partial on sub_merchant_id NULL / NOT NULL)
  // means the ON CONFLICT target must name the specific column(s) matching
  // the partial predicate. Split into merchant-level vs sub-level paths.
  const conflictClause =
    input.sub_merchant_id === null
      ? `ON CONFLICT (merchant_id) WHERE sub_merchant_id IS NULL`
      : `ON CONFLICT (merchant_id, sub_merchant_id) WHERE sub_merchant_id IS NOT NULL`;

  await query(
    `INSERT INTO merchant_settings
       (id, merchant_id, sub_merchant_id, collection_fee_pct, collection_fee_model,
        payout_fee_pct, payout_fee_model, settlement_fee_pct,
        notification_emails, enabled_methods)
     VALUES ($1,$2,$3,
             COALESCE($4, 1.5),
             COALESCE($5, 'merchant_covers'),
             COALESCE($6, 1.0),
             COALESCE($7, 'merchant_covers'),
             COALESCE($8, 0.0),
             COALESCE($9, ARRAY[]::text[]),
             COALESCE($10, ARRAY['mpesa','airtel']::text[]))
     ${conflictClause} DO UPDATE SET
       collection_fee_pct = COALESCE(EXCLUDED.collection_fee_pct, merchant_settings.collection_fee_pct),
       collection_fee_model = COALESCE(EXCLUDED.collection_fee_model, merchant_settings.collection_fee_model),
       payout_fee_pct = COALESCE(EXCLUDED.payout_fee_pct, merchant_settings.payout_fee_pct),
       payout_fee_model = COALESCE(EXCLUDED.payout_fee_model, merchant_settings.payout_fee_model),
       settlement_fee_pct = COALESCE(EXCLUDED.settlement_fee_pct, merchant_settings.settlement_fee_pct),
       notification_emails = COALESCE(EXCLUDED.notification_emails, merchant_settings.notification_emails),
       enabled_methods = COALESCE(EXCLUDED.enabled_methods, merchant_settings.enabled_methods),
       updated_at = now()`,
    [
      input.id,
      input.merchant_id,
      input.sub_merchant_id,
      input.collection_fee_pct ?? null,
      input.collection_fee_model ?? null,
      input.payout_fee_pct ?? null,
      input.payout_fee_model ?? null,
      input.settlement_fee_pct ?? null,
      input.notification_emails ?? null,
      input.enabled_methods ?? null,
    ],
  );
}
