import { query } from '@/infra/db/pool';
import { logger } from '@/infra/logger';
import { createSettlement, executeSettlement } from './settlement.service';

const FREQUENCY_INTERVALS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  'bi-weekly': 14 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export async function tickSettlementScheduler(): Promise<void> {
  const { rows: subs } = await query<{
    sub_merchant_id: string;
    merchant_id: string;
    settlement_frequency: string;
  }>(
    // Binding cadence source: merchant_settings.settlement_frequency (not sub_merchants.settlement_preference).
    // If both exist, merchant_settings wins. sub_merchants.settlement_preference is display-only.
    `SELECT DISTINCT c.sub_merchant_id, c.merchant_id, COALESCE(ms.settlement_frequency, 'weekly') as settlement_frequency
     FROM collections c
     LEFT JOIN merchant_settings ms ON ms.merchant_id = c.merchant_id AND ms.sub_merchant_id IS NULL
     WHERE c.business_status = 'successful'
       AND c.settlement_eligible = true
       AND c.settlement_batch_id IS NULL
     GROUP BY c.sub_merchant_id, c.merchant_id, ms.settlement_frequency
     HAVING COUNT(*) > 0`,
  );

  for (const sub of subs) {
    const intervalMs = FREQUENCY_INTERVALS[sub.settlement_frequency] ?? FREQUENCY_INTERVALS.weekly;

    const { rows: lastSettlement } = await query<{ created_at: string }>(
      `SELECT created_at FROM settlements
        WHERE sub_merchant_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [sub.sub_merchant_id],
    );

    const lastAt = lastSettlement[0]?.created_at
      ? new Date(lastSettlement[0].created_at).getTime()
      : 0;

    if (Date.now() - lastAt < intervalMs) {
      logger.info({
        sub_merchant_id: sub.sub_merchant_id,
        frequency: sub.settlement_frequency,
        last_settlement: lastSettlement[0]?.created_at ?? 'never',
        next_eligible: new Date(lastAt + intervalMs).toISOString(),
      }, 'settlement scheduler: skipping — not yet due');
      continue;
    }

    try {
      const result = await createSettlement({
        merchantId: sub.merchant_id,
        subMerchantId: sub.sub_merchant_id,
      });
      const status = await executeSettlement(result.settlement_id);
      logger.info({
        sub_merchant_id: sub.sub_merchant_id,
        settlement_id: result.settlement_id,
        net: result.net,
        status,
      }, 'auto-settlement executed');
    } catch (err) {
      logger.error({ err, sub_merchant_id: sub.sub_merchant_id },
        'auto-settlement failed');
    }
  }
}
