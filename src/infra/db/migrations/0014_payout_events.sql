-- Append-only lifecycle event log for payouts.
-- Mirrors collection_events (migration 0006) but for payout lifecycle.
-- Powers the Payout Detail → Integration Logs section.

CREATE TABLE IF NOT EXISTS payout_events (
  id              text PRIMARY KEY,
  payout_id       text NOT NULL REFERENCES payouts(id),
  event_type      text NOT NULL,
  source          text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_id      text,
  http_status     int,
  latency_ms      int,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  message         text
);

CREATE INDEX IF NOT EXISTS payout_events_payout_idx
  ON payout_events (payout_id, occurred_at);

CREATE INDEX IF NOT EXISTS payout_events_request_idx
  ON payout_events (request_id) WHERE request_id IS NOT NULL;
