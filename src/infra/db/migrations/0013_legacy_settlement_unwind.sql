-- Legacy settlement unwind: credit back the collection wallet for two
-- settlements that were marked 'paid' but never actually disbursed.
--
-- Mirrors what 5e9f4d9 does at dispatch time, applied retroactively.
-- Net amounts (not total_debit) are credited — payout fee was never charged.

WITH inserted AS (
  INSERT INTO ledger_entries (
    id, merchant_id, sub_merchant_id, wallet_id, wallet_type,
    transaction_type, direction, amount, currency,
    reference_type, reference_id, idempotency_key, description
  ) VALUES
    ('led_unwind_KRAJ60_credit',
     'mrc_01KQ1Y1V2FBEEZXAC6GD4M8Q1K', 'smrc_01KQ1YCET3F3CMMP9WTFDDDP7J',
     'wal_01KQ1YGH2DZ6KZTR7S6J5TMCV1', 'collection',
     'manual_adjustment', 'credit', 31600, 'KES',
     'settlement', 'stl_01KRAJ60S5SN4XXMJ33P6SCNCN',
     'legacy_settlement_unwind:stl_01KRAJ60S5SN4XXMJ33P6SCNCN',
     'Legacy unwind: settlement marked paid but never disbursed (net 31600)'),
    ('led_unwind_KQMVZ60_credit',
     'mrc_01KQ1Y1V2FBEEZXAC6GD4M8Q1K', 'smrc_01KQ1YCET3F3CMMP9WTFDDDP7J',
     'wal_01KQ1YGH2DZ6KZTR7S6J5TMCV1', 'collection',
     'manual_adjustment', 'credit', 9750, 'KES',
     'settlement', 'stl_01KQMVZ60FWTF3JBVKQ40MS21B',
     'legacy_settlement_unwind:stl_01KQMVZ60FWTF3JBVKQ40MS21B',
     'Legacy unwind: settlement marked paid but never disbursed (net 9750)')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING amount
)
UPDATE wallets
SET available_balance = available_balance + (SELECT COALESCE(SUM(amount), 0) FROM inserted),
    updated_at        = NOW()
WHERE id = 'wal_01KQ1YGH2DZ6KZTR7S6J5TMCV1'
  AND wallet_type = 'collection';
