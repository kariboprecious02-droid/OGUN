-- Cohort B drain: retire 3 pre-convergence-fix payouts whose wallet
-- reservations are stuck. Total: 100,546 cents across 3 payouts.
--
-- A + B combined: release payout-wallet reservations for all 3 stuck payouts.
-- Single CTE so the wallet UPDATE is tied to actual inserts.
-- Re-running this migration against a wallet that's already been drained
-- (e.g. by a prior manual cohort_b_drain run) results in SUM=0 → wallet untouched.

WITH inserted AS (
  INSERT INTO ledger_entries (
    id, merchant_id, sub_merchant_id, wallet_id, wallet_type,
    transaction_type, direction, amount, currency,
    reference_type, reference_id, idempotency_key, description
  ) VALUES
    ('led_drain_KRSDYZ_release',
     'mrc_01KQ1Y1V2FBEEZXAC6GD4M8Q1K', 'smrc_01KQ1YCET3F3CMMP9WTFDDDP7J',
     'wal_01KQ1YGH2HC4RJX2AQ8C7Z4PJ9', 'payout',
     'payout_release', 'credit', 58782, 'KES',
     'payout', 'pay_01KRSDYZCZGH8KKFBSC0RVH3V6',
     'cohort_b_drain:pay_01KRSDYZCZGH8KKFBSC0RVH3V6',
     'Cohort B drain: orphan payout — parent settlement deleted 2026-05-17'),
    ('led_drain_KRAJ65_release',
     'mrc_01KQ1Y1V2FBEEZXAC6GD4M8Q1K', 'smrc_01KQ1YCET3F3CMMP9WTFDDDP7J',
     'wal_01KQ1YGH2HC4RJX2AQ8C7Z4PJ9', 'payout',
     'payout_release', 'credit', 31916, 'KES',
     'payout', 'pay_01KRAJ65B6Y6M7EBNCETR6X4KN',
     'cohort_b_drain:pay_01KRAJ65B6Y6M7EBNCETR6X4KN',
     'Cohort B drain: legacy payout — no TRF code, settlement stl_01KRAJ60'),
    ('led_drain_KQMW0S_release',
     'mrc_01KQ1Y1V2FBEEZXAC6GD4M8Q1K', 'smrc_01KQ1YCET3F3CMMP9WTFDDDP7J',
     'wal_01KQ1YGH2HC4RJX2AQ8C7Z4PJ9', 'payout',
     'payout_release', 'credit', 9848, 'KES',
     'payout', 'pay_01KQMW0SVQQB06V2KCX49GNP70',
     'cohort_b_drain:pay_01KQMW0SVQQB06V2KCX49GNP70',
     'Cohort B drain: legacy payout — no TRF code, settlement stl_01KQMVZ60')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING amount
)
UPDATE wallets SET
  available_balance = available_balance + (SELECT COALESCE(SUM(amount), 0) FROM inserted),
  reserved_balance  = reserved_balance  - (SELECT COALESCE(SUM(amount), 0) FROM inserted),
  updated_at        = NOW()
WHERE id = 'wal_01KQ1YGH2HC4RJX2AQ8C7Z4PJ9'
  AND wallet_type = 'payout';

-- Mark all 3 payouts as failed with terminal state (idempotent via status filter).
UPDATE payouts SET
  status = 'failed',
  failure_reason = 'cohort_b_drain_pre_convergence_fix',
  final_resolved_at = NOW(),
  updated_at = NOW()
WHERE id IN (
  'pay_01KRSDYZCZGH8KKFBSC0RVH3V6',
  'pay_01KRAJ65B6Y6M7EBNCETR6X4KN',
  'pay_01KQMW0SVQQB06V2KCX49GNP70'
) AND status NOT IN ('succeeded', 'failed', 'reversed', 'cancelled');

-- Mark legacy settlements as failed (they claimed 'paid' but no bank transfer).
UPDATE settlements SET
  status = 'failed',
  updated_at = NOW()
WHERE id IN (
  'stl_01KRAJ60S5SN4XXMJ33P6SCNCN',
  'stl_01KQMVZ60FWTF3JBVKQ40MS21B'
) AND status = 'paid';

-- Item 2: Settings harmonization (Option A)
UPDATE sub_merchants SET
  settlement_preference = 'daily',
  updated_at = NOW()
WHERE id = 'smrc_01KQ1YCET3F3CMMP9WTFDDDP7J'
  AND settlement_preference != 'daily';
