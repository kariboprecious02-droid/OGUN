# H. Errors & Failure Reasons

Ogun errors split into two kinds:

- **API error codes** — returned synchronously in the response envelope.
- **Failure reasons** — attached to terminal `failed` / `refunded`
  states via the `status_reason` column and `failure_reason` field in
  webhook payloads.

## API error codes (§10.2)

| Code | HTTP | When |
| --- | --- | --- |
| `invalid_request` | 400 | Missing/invalid fields, shape validation failure |
| `unauthorized` | 401 | Missing or invalid Bearer token |
| `forbidden` | 403 | Publishable key on a secret-key route; admin guard |
| `resource_not_found` | 404 | Entity doesn't exist OR belongs to another merchant |
| `idempotency_conflict` | 409 | Same Idempotency-Key reused with a different body |
| `duplicate_request` | 409 | Existing resource with the same unique constraint |
| `merchant_not_active` | 422 | Merchant is draft / suspended / rejected |
| `sub_merchant_not_active` | 422 | Sub-merchant is not active |
| `method_not_enabled` | 422 | Sub-merchant has not enabled this payment method |
| `insufficient_payout_balance` | 422 | Payout wallet balance < `total_debit` (pre-provider) |
| `compliance_pending` | 422 | Operation requires an activated merchant |
| `provider_timeout` | 502 | Provider (Safaricom / Paystack) did not respond |
| `provider_rejected` | 502 | Provider explicitly rejected the request |
| `rate_limited` | 429 | Per-route rate limit exceeded (e.g. sync endpoints) |
| `internal_error` | 500 | Unhandled server-side error; logged with request_id |

Every error response carries a stable `request_id` in `meta` — log
it client-side and send it with any support tickets.

## Failure reasons

Attached to `collection.failed` / `payout.failed` webhooks and
`status_reason` fields on the detail views:

| Reason | Domain | Meaning |
| --- | --- | --- |
| `invalid_phone_number` | Collection / Payout | Customer/beneficiary phone is malformed |
| `customer_timeout` | Collection | Customer didn't complete the USSD / OTP prompt |
| `insufficient_customer_funds` | Collection | Customer doesn't have enough funds on their line |
| `provider_unavailable` | Both | Upstream provider is offline |
| `beneficiary_invalid` | Payout | Paystack couldn't resolve the transfer recipient |
| `payout_reversed` | Payout | Post-success reversal by provider |
| `settlement_threshold_not_met` | Settlement | Eligible amount below configured threshold |
| `collection_timed_out` | Collection | 5-minute TTL expired with no conclusive result |
| `provider_no_response` | Both | Provider accepted the request but never resolved it |
| `insufficient_collection_balance` | Settlement | Collection wallet cannot cover `net_amount` |

## Retry semantics

Ogun handles retries for you in most cases:

- **Webhooks**: retry on any non-2xx for up to 7 attempts.
- **Polling**: runs every 5 seconds until terminal or 5-minute TTL.
- **Your code**: safe to retry any `2xx`, `4xx`, or `5xx` POST that
  carries an `Idempotency-Key`. Safe retries return the cached
  response; unsafe retries (different body) return `409`.

## Signature / replay errors

Webhook signature failures on your side should return `401`. After
100 consecutive 401/4xx responses on the same endpoint, Ogun
auto-disables the endpoint and notifies the merchant contact email.
Re-enable it via `PUT /v1/webhook-endpoints/:id` with `is_active: true`
after fixing your handler.

## Dead-letter storage

Webhook deliveries that fail the full retry schedule land in
`webhook_deliveries` with `delivery_status=failed`. Ogun retains
them for 30 days so you can replay manually via the admin console if
your downstream system had an outage.

---

[← Back to index](./README.md)
