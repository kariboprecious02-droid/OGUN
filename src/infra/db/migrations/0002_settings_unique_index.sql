-- Ogun migration 0002: fix merchant_settings uniqueness for NULL sub_merchant_id
--
-- The original UNIQUE (merchant_id, sub_merchant_id) constraint in 0001
-- allowed duplicate rows at the merchant-level because Postgres treats
-- NULL values in unique indexes as distinct.  We need exactly one
-- merchant-level row per merchant and exactly one row per (merchant, sub)
-- pair.
--
-- Drop the old composite unique constraint, replace with two partial
-- unique indexes that handle the NULL / NOT NULL cases explicitly.

BEGIN;

-- Deduplicate existing merchant-level rows (keep the most recently
-- updated one) before adding the new index so the create doesn't fail.
DELETE FROM merchant_settings a
  USING merchant_settings b
  WHERE a.ctid < b.ctid
    AND a.merchant_id = b.merchant_id
    AND a.sub_merchant_id IS NULL
    AND b.sub_merchant_id IS NULL;

ALTER TABLE merchant_settings
  DROP CONSTRAINT IF EXISTS merchant_settings_merchant_id_sub_merchant_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_merchant_settings_merchant_only
  ON merchant_settings (merchant_id)
  WHERE sub_merchant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_merchant_settings_with_sub
  ON merchant_settings (merchant_id, sub_merchant_id)
  WHERE sub_merchant_id IS NOT NULL;

COMMIT;
