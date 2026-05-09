-- Add provider detail columns to collections so the detail view
-- can display them without recomputing from the response shape.

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS provider_call_state varchar(40),
  ADD COLUMN IF NOT EXISTS provider_message text,
  ADD COLUMN IF NOT EXISTS next_action varchar(40);
