-- Persist inbound Paystack webhook raw payloads for forensic debug.
-- Powers the Integration Logs tab on the collection detail view.
-- collection_id is nullable: webhooks may arrive for collections that
-- exist in a different environment's database (shared-credentials topology).

CREATE TABLE IF NOT EXISTS paystack_webhook_events (
  id                   varchar(40) PRIMARY KEY,
  collection_id        varchar(40) REFERENCES collections(id),
  event_type           varchar(60) NOT NULL,
  raw_payload          jsonb NOT NULL,
  signature_valid      boolean NOT NULL,
  http_status_returned smallint NOT NULL DEFAULT 200,
  received_at          timestamptz NOT NULL DEFAULT now(),
  processed_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_paystack_webhook_events_collection
  ON paystack_webhook_events(collection_id);
