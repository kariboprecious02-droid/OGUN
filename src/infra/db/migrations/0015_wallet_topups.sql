-- Wallet top-up records for admin-initiated funding.
-- Each row produces a wallet_topup_credit ledger entry.

CREATE TABLE IF NOT EXISTS wallet_topups (
  id                text PRIMARY KEY,
  wallet_id         text NOT NULL REFERENCES wallets(id),
  merchant_id       text NOT NULL REFERENCES merchants(id),
  sub_merchant_id   text NOT NULL REFERENCES sub_merchants(id),
  amount            bigint NOT NULL,
  currency          char(3) NOT NULL DEFAULT 'KES',
  source            text NOT NULL,
  source_reference  text NOT NULL UNIQUE,
  reason            text NOT NULL,
  initiated_by      text NOT NULL,
  status            text NOT NULL DEFAULT 'settled',
  fee_amount        bigint NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_topups_wallet_idx ON wallet_topups (wallet_id, created_at DESC);

-- Add freeze columns to wallets table
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS is_frozen boolean NOT NULL DEFAULT false;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS freeze_reason text;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS frozen_by text;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS low_balance_threshold bigint NOT NULL DEFAULT 5000;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS last_funded_at timestamptz;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS last_funded_by text;
