-- Settlement account details on merchant_settings so admins can
-- edit bank/mobile money payout destination from the Settings tab.

ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS settlement_bank_name text,
  ADD COLUMN IF NOT EXISTS settlement_account_number text,
  ADD COLUMN IF NOT EXISTS settlement_branch_code text,
  ADD COLUMN IF NOT EXISTS settlement_account_holder text;
