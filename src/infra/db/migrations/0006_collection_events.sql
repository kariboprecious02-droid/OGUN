-- Append-only lifecycle event log for collections.
-- Powers the Transaction Detail View and operator-queryable lifecycle history.
-- See docs/observability-audit/observability-audit.md §5 L2.

CREATE TABLE IF NOT EXISTS collection_events (
  id              text PRIMARY KEY,
  collection_id   text NOT NULL REFERENCES collections(id),
  event_type      text NOT NULL,
  source          text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  request_id      text,
  http_status     int,
  latency_ms      int,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  message         text
);

CREATE INDEX collection_events_collection_idx
  ON collection_events (collection_id, occurred_at);

CREATE INDEX collection_events_request_idx
  ON collection_events (request_id) WHERE request_id IS NOT NULL;
