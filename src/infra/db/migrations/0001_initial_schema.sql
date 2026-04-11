-- Ogun Payment Infrastructure Platform
-- Initial schema migration (PostgreSQL)
-- Derived from Execution Spec v4.1.0 Section 3

BEGIN;

-- ============================================================
-- MERCHANT & SUB-MERCHANT
-- ============================================================

CREATE TABLE IF NOT EXISTS merchants (
    id                         varchar(30) PRIMARY KEY,
    legal_name                 varchar(255) NOT NULL,
    trading_name               varchar(255) NOT NULL,
    registration_number        varchar(100),
    tax_id                     varchar(50),
    country                    char(2) NOT NULL DEFAULT 'KE',
    settlement_currency        char(3) NOT NULL DEFAULT 'KES',
    business_category          varchar(100),
    business_address           jsonb,
    website_url                varchar(500),
    expected_monthly_volume    bigint,
    expected_avg_ticket        bigint,
    contact_name               varchar(255),
    contact_email              varchar(255),
    contact_phone              varchar(30),
    status                     varchar(30) NOT NULL DEFAULT 'draft',
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status);

CREATE TABLE IF NOT EXISTS sub_merchants (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name                       varchar(255) NOT NULL,
    code                       varchar(50),
    status                     varchar(30) NOT NULL DEFAULT 'draft',
    settlement_preference      varchar(20),
    settlement_destination     jsonb,
    contact_name               varchar(255),
    contact_email              varchar(255),
    contact_phone              varchar(30),
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sub_merchants_merchant ON sub_merchants(merchant_id);

-- ============================================================
-- MERCHANT SETTINGS (inheritable by sub-merchant)
-- ============================================================

CREATE TABLE IF NOT EXISTS merchant_settings (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) REFERENCES sub_merchants(id) ON DELETE CASCADE,
    collection_fee_pct         numeric(8,4) NOT NULL DEFAULT 1.5000,
    collection_fee_model       varchar(20) NOT NULL DEFAULT 'merchant_covers',
    payout_fee_pct             numeric(8,4) NOT NULL DEFAULT 1.0000,
    payout_fee_model           varchar(20) NOT NULL DEFAULT 'merchant_covers',
    settlement_fee_pct         numeric(8,4) NOT NULL DEFAULT 0.0000,
    notification_emails        text[] NOT NULL DEFAULT ARRAY[]::text[],
    enabled_methods            text[] NOT NULL DEFAULT ARRAY['mpesa','airtel']::text[],
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, sub_merchant_id)
);

-- ============================================================
-- DOCUMENTS & COMPLIANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) REFERENCES sub_merchants(id) ON DELETE CASCADE,
    type                       varchar(50) NOT NULL,
    file_url                   varchar(1000) NOT NULL,
    file_hash                  varchar(64),
    extracted_data             jsonb,
    extraction_confidence      numeric(5,2),
    review_status              varchar(30) NOT NULL DEFAULT 'pending',
    uploader_id                varchar(30),
    uploaded_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_merchant ON documents(merchant_id);

CREATE TABLE IF NOT EXISTS compliance_reviews (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) REFERENCES sub_merchants(id) ON DELETE CASCADE,
    reviewer_type              varchar(20) NOT NULL,
    decision                   varchar(20) NOT NULL,
    notes                      text,
    confidence_score           numeric(5,2),
    flags_raised               jsonb,
    extracted_fields           jsonb,
    explanation_summary        text,
    model_identifier           varchar(100),
    actor_id                   varchar(30),
    previous_status            varchar(30),
    new_status                 varchar(30),
    created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_reviews_merchant ON compliance_reviews(merchant_id);

CREATE TABLE IF NOT EXISTS compliance_rule_results (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    rule_name                  varchar(100) NOT NULL,
    passed                     boolean NOT NULL,
    details                    jsonb,
    created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchant_feedback_requests (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    compliance_review_id       varchar(30) REFERENCES compliance_reviews(id),
    affected_section           varchar(100),
    feedback_text              text NOT NULL,
    resolved                   boolean NOT NULL DEFAULT false,
    created_at                 timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- WALLETS & LEDGER
-- ============================================================

CREATE TABLE IF NOT EXISTS wallets (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) NOT NULL REFERENCES sub_merchants(id) ON DELETE CASCADE,
    wallet_type                varchar(20) NOT NULL,
    currency                   char(3) NOT NULL DEFAULT 'KES',
    available_balance          bigint NOT NULL DEFAULT 0,
    reserved_balance           bigint NOT NULL DEFAULT 0,
    status                     varchar(20) NOT NULL DEFAULT 'active',
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sub_merchant_id, wallet_type, currency)
);

CREATE INDEX IF NOT EXISTS idx_wallets_sub_merchant ON wallets(sub_merchant_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) NOT NULL REFERENCES sub_merchants(id) ON DELETE CASCADE,
    wallet_id                  varchar(30) NOT NULL REFERENCES wallets(id),
    wallet_type                varchar(20) NOT NULL,
    transaction_type           varchar(40) NOT NULL,
    direction                  varchar(10) NOT NULL CHECK (direction IN ('credit','debit')),
    amount                     bigint NOT NULL CHECK (amount >= 0),
    currency                   char(3) NOT NULL,
    reference_type             varchar(30) NOT NULL,
    reference_id               varchar(30) NOT NULL,
    idempotency_key            varchar(120) UNIQUE,
    description                text,
    created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON ledger_entries(wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_reference ON ledger_entries(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger_entries(created_at);

-- ============================================================
-- COLLECTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS collections (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) NOT NULL REFERENCES sub_merchants(id) ON DELETE CASCADE,
    amount                     bigint NOT NULL,
    fee_amount                 bigint NOT NULL DEFAULT 0,
    customer_amount            bigint NOT NULL,
    currency                   char(3) NOT NULL,
    method                     varchar(30) NOT NULL,
    provider                   varchar(30) NOT NULL,
    merchant_reference         varchar(100),
    provider_reference         varchar(100),
    internal_status            varchar(30) NOT NULL DEFAULT 'created',
    business_status            varchar(20) NOT NULL DEFAULT 'pending',
    status_reason              varchar(100),
    customer_name              varchar(255),
    customer_phone             varchar(30) NOT NULL,
    customer_email             varchar(255),
    fee_snapshot               jsonb NOT NULL,
    provider_submission_at     timestamptz,
    final_resolved_at          timestamptz,
    webhook_received_at        timestamptz,
    last_webhook_at            timestamptz,
    poller_started_at          timestamptz,
    last_polled_at             timestamptz,
    poll_attempt_count         integer NOT NULL DEFAULT 0,
    polling_stopped_at         timestamptz,
    polling_stop_reason        varchar(50),
    settlement_eligible        boolean NOT NULL DEFAULT false,
    settlement_eligible_at     timestamptz,
    wallet_credited            boolean NOT NULL DEFAULT false,
    wallet_credited_at         timestamptz,
    refund_status              varchar(20) NOT NULL DEFAULT 'none',
    refunded_amount            bigint,
    refund_timestamp           timestamptz,
    refund_reference           varchar(100),
    settlement_batch_id        varchar(30),
    metadata                   jsonb,
    idempotency_key            varchar(120) UNIQUE,
    expires_at                 timestamptz,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collections_sub_merchant ON collections(sub_merchant_id);
CREATE INDEX IF NOT EXISTS idx_collections_business_status ON collections(business_status);
CREATE INDEX IF NOT EXISTS idx_collections_internal_status ON collections(internal_status);
CREATE INDEX IF NOT EXISTS idx_collections_created_at ON collections(created_at);
CREATE INDEX IF NOT EXISTS idx_collections_provider_reference ON collections(provider_reference);
CREATE INDEX IF NOT EXISTS idx_collections_settlement_eligible ON collections(settlement_eligible, settlement_batch_id);

CREATE TABLE IF NOT EXISTS collection_audit_events (
    id                         varchar(30) PRIMARY KEY,
    collection_id              varchar(30) NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    event_source               varchar(20) NOT NULL,
    event_type                 varchar(50) NOT NULL,
    previous_internal_status   varchar(30),
    new_internal_status        varchar(30),
    previous_business_status   varchar(20),
    new_business_status        varchar(20),
    provider_payload_hash      varchar(64),
    idempotency_key            varchar(120),
    details                    jsonb,
    created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coll_audit_collection ON collection_audit_events(collection_id);

-- ============================================================
-- BENEFICIARIES & PAYOUTS
-- ============================================================

CREATE TABLE IF NOT EXISTS beneficiaries (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) NOT NULL REFERENCES sub_merchants(id) ON DELETE CASCADE,
    beneficiary_type           varchar(20) NOT NULL,
    provider                   varchar(20) NOT NULL DEFAULT 'paystack',
    provider_recipient_type    varchar(30),
    provider_recipient_code    varchar(100),
    name                       varchar(255) NOT NULL,
    mobile_number              varchar(30),
    bank_code                  varchar(20),
    account_number             varchar(30),
    currency                   char(3) NOT NULL DEFAULT 'KES',
    verification_status        varchar(20) NOT NULL DEFAULT 'pending',
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_beneficiaries_sub_merchant ON beneficiaries(sub_merchant_id);

CREATE TABLE IF NOT EXISTS payouts (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) NOT NULL REFERENCES sub_merchants(id) ON DELETE CASCADE,
    beneficiary_id             varchar(30) NOT NULL REFERENCES beneficiaries(id),
    amount                     bigint NOT NULL,
    fee_amount                 bigint NOT NULL DEFAULT 0,
    total_debit                bigint NOT NULL,
    recipient_amount           bigint NOT NULL,
    fee_model                  varchar(20) NOT NULL,
    fee_snapshot               jsonb NOT NULL,
    currency                   char(3) NOT NULL,
    method                     varchar(30) NOT NULL,
    provider                   varchar(20) NOT NULL,
    internal_method            varchar(30) NOT NULL,
    status                     varchar(30) NOT NULL DEFAULT 'created',
    provider_reference         varchar(100),
    provider_transfer_code     varchar(100),
    provider_status            varchar(50),
    external_reference         varchar(100),
    wallet_reserved_amount     bigint NOT NULL DEFAULT 0,
    wallet_reserved_at         timestamptz,
    final_resolved_at          timestamptz,
    reversal_indicator         boolean NOT NULL DEFAULT false,
    reversal_reason            varchar(100),
    failure_reason             varchar(100),
    metadata                   jsonb,
    fee_model_source           varchar(30),
    idempotency_key            varchar(120) UNIQUE,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payouts_sub_merchant ON payouts(sub_merchant_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_provider_reference ON payouts(provider_reference);

-- ============================================================
-- SETTLEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS settlements (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) NOT NULL REFERENCES sub_merchants(id) ON DELETE CASCADE,
    period_start               timestamptz NOT NULL,
    period_end                 timestamptz NOT NULL,
    gross_amount               bigint NOT NULL,
    fee_amount                 bigint NOT NULL,
    settlement_fee             bigint NOT NULL,
    refund_adjustment_amount   bigint NOT NULL DEFAULT 0,
    other_adjustment_amount    bigint NOT NULL DEFAULT 0,
    net_amount                 bigint NOT NULL,
    transaction_count          integer NOT NULL,
    status                     varchar(30) NOT NULL,
    payout_id                  varchar(30) REFERENCES payouts(id),
    report_url                 varchar(500),
    destination_summary        jsonb,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlements_sub_merchant ON settlements(sub_merchant_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);

CREATE TABLE IF NOT EXISTS settlement_line_items (
    id                         varchar(30) PRIMARY KEY,
    settlement_id              varchar(30) NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
    reference_type             varchar(30) NOT NULL,
    reference_id               varchar(30) NOT NULL,
    amount                     bigint NOT NULL,
    direction                  varchar(10) NOT NULL CHECK (direction IN ('credit','debit')),
    created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlement_lines_settlement ON settlement_line_items(settlement_id);

-- ============================================================
-- CREDENTIALS, WEBHOOKS, POLLING, NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS api_credentials (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    key_type                   varchar(30) NOT NULL,
    masked_value               varchar(60) NOT NULL,
    hashed_value               varchar(128) NOT NULL,
    environment                varchar(20) NOT NULL,
    is_active                  boolean NOT NULL DEFAULT true,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    rotated_at                 timestamptz
);

CREATE INDEX IF NOT EXISTS idx_api_credentials_merchant ON api_credentials(merchant_id);
CREATE INDEX IF NOT EXISTS idx_api_credentials_hash ON api_credentials(hashed_value) WHERE is_active;

CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    url                        varchar(1000) NOT NULL,
    secret_hash                varchar(128) NOT NULL,
    subscribed_events          text[] NOT NULL DEFAULT ARRAY[]::text[],
    is_active                  boolean NOT NULL DEFAULT true,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    webhook_endpoint_id        varchar(30) REFERENCES webhook_endpoints(id),
    event_type                 varchar(60) NOT NULL,
    event_id                   varchar(40) NOT NULL,
    payload                    jsonb NOT NULL,
    payload_hash               varchar(64) NOT NULL,
    delivery_status            varchar(20) NOT NULL DEFAULT 'pending',
    http_status                integer,
    attempt_count              integer NOT NULL DEFAULT 0,
    last_attempt_at            timestamptz,
    next_retry_at              timestamptz,
    last_error                 text,
    created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_merchant ON webhook_deliveries(merchant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(delivery_status, next_retry_at);

CREATE TABLE IF NOT EXISTS polling_jobs (
    id                         varchar(30) PRIMARY KEY,
    reference_type             varchar(30) NOT NULL,
    reference_id               varchar(30) NOT NULL,
    provider_reference         varchar(100),
    provider                   varchar(30) NOT NULL,
    poll_count                 integer NOT NULL DEFAULT 0,
    started_at                 timestamptz NOT NULL DEFAULT now(),
    next_poll_at               timestamptz NOT NULL,
    ttl_expires_at             timestamptz NOT NULL,
    stopped_at                 timestamptz,
    stop_reason                varchar(50),
    status                     varchar(20) NOT NULL DEFAULT 'active',
    UNIQUE (reference_type, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_polling_jobs_active ON polling_jobs(status, next_poll_at);

CREATE TABLE IF NOT EXISTS notification_endpoints (
    id                         varchar(30) PRIMARY KEY,
    merchant_id                varchar(30) NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sub_merchant_id            varchar(30) REFERENCES sub_merchants(id) ON DELETE CASCADE,
    channel                    varchar(20) NOT NULL,
    address                    varchar(255) NOT NULL,
    is_active                  boolean NOT NULL DEFAULT true,
    created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id                         varchar(30) PRIMARY KEY,
    actor_type                 varchar(30) NOT NULL,
    actor_id                   varchar(30),
    action                     varchar(60) NOT NULL,
    entity_type                varchar(40) NOT NULL,
    entity_id                  varchar(30) NOT NULL,
    previous_status            varchar(40),
    new_status                 varchar(40),
    changes                    jsonb,
    ip_address                 varchar(45),
    created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

COMMIT;
