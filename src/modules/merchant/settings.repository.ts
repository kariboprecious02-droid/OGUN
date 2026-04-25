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
  enabled_payout_methods: string[];
  settlement_frequency: string;
  webhook_url: string | null;
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
  enabled_payout_methods: string[];
  settlement_frequency: string;
  webhook_url: string | null;
  notification_emails: string[];
  source: 'merchant' | 'sub_merchant';
}> {
  const { rows: subRows } = subMerchantId
    ? await query<MerchantSettingsRow>(
        `SELECT * FROM merchant_settings
          WHERE merchant_id = $1 AND sub_merchant_id = $2 LIMIT 1`,
        [merchantId, subMerchantId],
      )
    : { rows: [] as MerchantSettingsRow[] };

  const toResult = (row: MerchantSettingsRow, source: 'merchant' | 'sub_merchant') => ({
    collection_fee_pct: Number(row.collection_fee_pct),
    collection_fee_model: row.collection_fee_model,
    payout_fee_pct: Number(row.payout_fee_pct),
    payout_fee_model: row.payout_fee_model,
    settlement_fee_pct: Number(row.settlement_fee_pct),
    enabled_methods: row.enabled_methods,
    enabled_payout_methods: row.enabled_payout_methods ?? [],
    settlement_frequency: row.settlement_frequency ?? 'weekly',
    webhook_url: row.webhook_url ?? null,
    notification_emails: row.notification_emails ?? [],
    source,
  });

  if (subRows[0]) return toResult(subRows[0], 'sub_merchant');

  const { rows: merchantRows } = await query<MerchantSettingsRow>(
    `SELECT * FROM merchant_settings
      WHERE merchant_id = $1 AND sub_merchant_id IS NULL LIMIT 1`,
    [merchantId],
  );
  if (merchantRows[0]) return toResult(merchantRows[0], 'merchant');

  return {
    collection_fee_pct: 1.5,
    collection_fee_model: 'merchant_covers',
    payout_fee_pct: 1.0,
    payout_fee_model: 'merchant_covers',
    settlement_fee_pct: 0,
    enabled_methods: ['mpesa', 'airtel'],
    enabled_payout_methods: [],
    settlement_frequency: 'weekly',
    webhook_url: null,
    notification_emails: [],
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
  enabled_payout_methods?: string[];
  settlement_frequency?: string;
  webhook_url?: string | null;
}): Promise<void> {
  const conflictClause =
    input.sub_merchant_id === null
      ? `ON CONFLICT (merchant_id) WHERE sub_merchant_id IS NULL`
      : `ON CONFLICT (merchant_id, sub_merchant_id) WHERE sub_merchant_id IS NOT NULL`;

  await query(
    `INSERT INTO merchant_settings
       (id, merchant_id, sub_merchant_id, collection_fee_pct, collection_fee_model,
        payout_fee_pct, payout_fee_model, settlement_fee_pct,
        notification_emails, enabled_methods,
        enabled_payout_methods, settlement_frequency, webhook_url)
     VALUES ($1,$2,$3,
             COALESCE($4, 1.5),
             COALESCE($5, 'merchant_covers'),
             COALESCE($6, 1.0),
             COALESCE($7, 'merchant_covers'),
             COALESCE($8, 0.0),
             COALESCE($9, ARRAY[]::text[]),
             COALESCE($10, ARRAY['mpesa','airtel']::text[]),
             COALESCE($11, ARRAY[]::text[]),
             COALESCE($12, 'weekly'),
             $13)
     ${conflictClause} DO UPDATE SET
       collection_fee_pct = COALESCE(EXCLUDED.collection_fee_pct, merchant_settings.collection_fee_pct),
       collection_fee_model = COALESCE(EXCLUDED.collection_fee_model, merchant_settings.collection_fee_model),
       payout_fee_pct = COALESCE(EXCLUDED.payout_fee_pct, merchant_settings.payout_fee_pct),
       payout_fee_model = COALESCE(EXCLUDED.payout_fee_model, merchant_settings.payout_fee_model),
       settlement_fee_pct = COALESCE(EXCLUDED.settlement_fee_pct, merchant_settings.settlement_fee_pct),
       notification_emails = COALESCE(EXCLUDED.notification_emails, merchant_settings.notification_emails),
       enabled_methods = COALESCE(EXCLUDED.enabled_methods, merchant_settings.enabled_methods),
       enabled_payout_methods = COALESCE(EXCLUDED.enabled_payout_methods, merchant_settings.enabled_payout_methods),
       settlement_frequency = COALESCE(EXCLUDED.settlement_frequency, merchant_settings.settlement_frequency),
       webhook_url = COALESCE(EXCLUDED.webhook_url, merchant_settings.webhook_url),
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
      input.enabled_payout_methods ?? null,
      input.settlement_frequency ?? null,
      input.webhook_url,
    ],
  );
}
