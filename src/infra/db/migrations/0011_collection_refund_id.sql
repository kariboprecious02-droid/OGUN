-- Store the Paystack refund ID for polling GET /refund/{id}.
-- Also track the provider-side refund status separately from OGUN's refund_status.

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS provider_refund_id bigint,
  ADD COLUMN IF NOT EXISTS provider_refund_status varchar(40);
