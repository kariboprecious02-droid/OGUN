-- Round settlement net_amount to whole KES for Paystack mobile money compatibility.
-- The rounding delta (always 0-99 cents) is tracked as settlement_rounding_subsidy.

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS settlement_rounding_subsidy bigint NOT NULL DEFAULT 0;
