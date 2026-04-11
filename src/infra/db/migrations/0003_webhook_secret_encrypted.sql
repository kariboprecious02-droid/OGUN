-- Ogun migration 0003: store encrypted webhook signing secrets
--
-- The initial schema stored only a SHA-256 hash of the webhook secret,
-- which is one-way and therefore unusable for signing outbound payloads.
-- Outbound dispatch needs the plaintext (or something decryptable) at
-- runtime so each merchant endpoint can be signed with its own unique
-- secret rather than the platform-wide salt.
--
-- This migration adds an AES-256-GCM encrypted envelope column. The
-- existing `secret_hash` column is retained so inbound verification
-- continues to work (we verify against the hash when needed) but new
-- endpoints created after this migration populate `secret_encrypted`.
--
-- Old endpoints without an encrypted secret fall back to the
-- platform-wide signing salt for backwards compatibility.

BEGIN;

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS secret_encrypted text;

COMMIT;
