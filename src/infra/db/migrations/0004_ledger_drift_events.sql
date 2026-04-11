-- Ogun migration 0004: ledger drift events
--
-- The reconciliation worker (§3.5 / §13.4) verifies the wallet
-- invariant hourly. Any drift is recorded here so ops can page on it
-- and the audit trail survives log rotation.
--
-- This table is append-only: rows are never updated or deleted.

BEGIN;

CREATE TABLE IF NOT EXISTS ledger_drift_events (
    id                   varchar(40) PRIMARY KEY,
    wallet_id            varchar(40) NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    sub_merchant_id      varchar(40) NOT NULL REFERENCES sub_merchants(id) ON DELETE CASCADE,
    wallet_type          varchar(20) NOT NULL,
    stored_available     bigint NOT NULL,
    derived_available    bigint NOT NULL,
    stored_reserved      bigint NOT NULL,
    derived_reserved     bigint NOT NULL,
    available_delta      bigint NOT NULL,
    reserved_delta       bigint NOT NULL,
    detected_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_drift_wallet ON ledger_drift_events(wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_drift_detected ON ledger_drift_events(detected_at);

COMMIT;
