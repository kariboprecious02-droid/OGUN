# G. Testing

Ogun's sandbox is a full copy of production with a deterministic
demo provider so you can exercise every scenario end-to-end without
any real money moving.

## 1. Sandbox setup

Sign up at <https://sandbox.ogun.com> (or use the seed script if
you're running Ogun locally). You get:

- Sandbox credentials: `sk_test_*`, `pk_test_*`, `whsec_test_*`
- A pre-seeded payout wallet with KES 1,000,000
- The demo simulator enabled for `method=demo`

## 2. Demo phone scenarios

The demo simulator dispatches by the **last three digits of the
customer phone number** (for collections) or **beneficiary mobile
number** (for payouts). Each scenario exercises a specific code path
so you can verify your webhook handlers cover all of them.

| Phone ends | Scenario | Collection result | Payout result |
| --- | --- | --- | --- |
| `001` | Instant success | `succeeded` immediately | `succeeded` immediately |
| `002` | Customer timeout | Poller resolves to `failed` (`customer_timeout`) | Poller resolves to `failed` |
| `003` | Success via poller | Stays pending → poller returns `succeeded` | Stays processing → poller returns `succeeded` |
| `004` | Provider failure | Immediate `failed` (`provider_unavailable`) | Immediate `failed` |
| `005` | Poller-only success | No webhook path; poller resolves `succeeded` | Poller resolves `succeeded` |
| `006` | Duplicate webhook handling | Succeeds; second webhook is a no-op | Succeeds |
| `007` | 5-minute TTL | Stays pending; poller TTL expires → `timed_out` / `failed` | Succeeds then reversed |

Example: trigger a timeout-to-failed for collections.

```bash
curl -sSL https://sandbox.ogun.com/v1/collections \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "merchant_id": "mrc_...",
    "sub_merchant_id": "smrc_...",
    "amount": 1000,
    "currency": "KES",
    "method": "demo",
    "customer": { "phone": "+254700000007" }
  }'
```

Within 5 minutes the collection transitions to `failed` with
`status_reason=collection_timed_out`, and you receive a
`collection.failed` webhook.

## 3. Fee model variants

Test both fee models by flipping the setting and re-running a
collection:

```bash
# merchant_covers (default)
curl -sSL -X PATCH https://sandbox.ogun.com/v1/merchants/mrc_.../settings \
  -d '{ "collection_fee_pct": 1.5, "collection_fee_model": "merchant_covers" }'

# payer_covers
curl -sSL -X PATCH https://sandbox.ogun.com/v1/merchants/mrc_.../settings \
  -d '{ "collection_fee_pct": 1.5, "collection_fee_model": "payer_covers" }'
```

The response from `POST /v1/collections` changes to reflect the new
model: `customer_amount` differs, and the wallet credit differs.

## 4. Refund testing

Create a successful collection, then issue partial + full refunds:

```bash
# Full refund
curl -sSL -X POST https://sandbox.ogun.com/v1/collections/col_.../refund \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{ "amount": 1000 }'

# Partial refund (create a second collection first)
curl -sSL -X POST https://sandbox.ogun.com/v1/collections/col_xyz/refund \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{ "amount": 300 }'
```

Assert that `business_status` flips to `refunded` for the full refund
and stays `successful` (with `refund_status=partial_refund`) for the
partial refund.

## 5. Idempotency edge cases

```bash
KEY=$(uuidgen)

# First call — 201 Created
curl -sSL -X POST /v1/collections -H "Idempotency-Key: $KEY" -d '{"amount":100,...}'

# Same key + same body — returns the cached 201
curl -sSL -X POST /v1/collections -H "Idempotency-Key: $KEY" -d '{"amount":100,...}'

# Same key + DIFFERENT body — 409 idempotency_conflict
curl -sSL -X POST /v1/collections -H "Idempotency-Key: $KEY" -d '{"amount":200,...}'
```

Ogun keeps the idempotency cache for 24 hours per (merchant, route, key).

## 6. Webhook delivery testing

Register an endpoint pointed at a request-capturing service like
webhook.site or your own test harness, then fire a synthetic event:

```bash
curl -sSL -X POST https://sandbox.ogun.com/v1/webhook-endpoints/wep_.../test \
  -H "Authorization: Bearer sk_test_..."
```

The endpoint receives a `merchant.activated` event signed with your
endpoint's own secret. Verify the `X-Ogun-Signature` header to
exercise your handler's HMAC path.

## 7. Ledger reconciliation

Every hour, Ogun reconciles each wallet's stored balance against the
sum of its ledger entries. If you're debugging a reconciliation issue
in sandbox, you can kick off a manual run from the admin console or
by importing the reconciliation function directly. Drift events are
stored in `ledger_drift_events` for later review.

---

Next: [H. Errors](./08-errors.md)
