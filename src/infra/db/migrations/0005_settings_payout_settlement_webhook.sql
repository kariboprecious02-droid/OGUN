-- §4.2.1 + §4.2.2 + §4.2.4: add enabled_payout_methods, settlement_frequency,
-- and webhook_url to merchant_settings.

ALTER TABLE merchant_settings
  ADD COLUMN IF NOT EXISTS enabled_payout_methods text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS settlement_frequency   varchar(20) NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS webhook_url            text;
