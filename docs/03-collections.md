# C. Collections

Collections move money **from a customer** into your collection
wallet. Ogun supports two routes:

| Method | Provider | Internal rail |
| --- | --- | --- |
| `mpesa` | Safaricom Daraja (direct) | STK Push |
| `airtel` | Paystack | Mobile money charge |
| `demo` | Ogun demo simulator (sandbox only) | Deterministic scenarios |

M-Pesa never routes through Paystack, which means M-Pesa transactions
clear directly against the Safaricom paybill number.

## 1. Create a collection

```bash
curl -sSL https://sandbox.ogun.com/v1/collections \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "mrc_01KWARA...",
    "sub_merchant_id": "smrc_01NAI...",
    "amount": 100000,
    "currency": "KES",
    "method": "mpesa",
    "customer": {
      "phone": "+254712345678",
      "name": "Jane Customer",
      "email": "jane@example.com"
    },
    "reference": "invoice-1001",
    "metadata": { "loan_id": "LN-01" }
  }'
```

The request returns immediately with `business_status: "pending"`:

```json
{
  "status": "success",
  "data": {
    "id": "col_01H...",
    "business_status": "pending",
    "amount": 100000,
    "fee_amount": 1500,
    "customer_amount": 100000,
    "method": "mpesa",
    "provider": "safaricom",
    "reference": "invoice-1001",
    "created_at": "2026-04-05T10:30:00Z"
  }
}
```

Amounts are always in cents: `100000` = KES 1,000.

## 2. The dual-state model

Ogun tracks two different status fields on every collection:

- **`business_status`** — a normalized value merchants see in list
  views, exports, and webhooks. Only four values:
  `pending`, `successful`, `failed`, `refunded`.
- **`internal_status`** — a lifecycle state used for debugging:
  `created`, `pending_customer_action`, `processing`, `succeeded`,
  `timed_out`, `expired`, `cancelled`, `failed`, `refunded`, `reversed`.

`GET /v1/collections/:id` (detail view) returns both. `GET /v1/collections`
(list view) returns only `business_status`. This keeps merchant
dashboards simple while giving engineers the depth they need when
debugging reconciliation.

## 3. Fee models

Ogun supports two collection fee models, chosen per merchant or
per sub-merchant via settings:

### merchant_covers (default)

The customer pays the full `amount`. The platform fee is debited from
the merchant's collection wallet. The merchant's net credit is
`amount - fee`.

```
amount            = 100000   (KES 1,000.00)
customer_amount   = 100000   (customer pays this)
fee_amount        = 1500     (1.5% fee)
wallet_credit     = 100000   (full gross)
fee_debit         = 1500     (platform fee)
net wallet change = 98500    (what the merchant actually keeps)
```

### payer_covers

The customer pays `amount + fee`. The merchant's wallet is credited
with the full `amount`.

```
amount            = 100000
customer_amount   = 101500   (customer pays amount + fee)
fee_amount        = 1500
wallet_credit     = 100000   (full amount; no fee debit)
net wallet change = 100000
```

Update via `PATCH /v1/merchants/:id/settings`:

```bash
curl -sSL -X PATCH https://sandbox.ogun.com/v1/merchants/mrc_.../settings \
  -H "Authorization: Bearer sk_test_..." \
  -d '{ "collection_fee_model": "payer_covers", "collection_fee_pct": 1.5 }'
```

## 4. Webhook + poller resolution

After you POST a collection, here's what happens:

1. Ogun validates the merchant + sub-merchant, snapshots the fee, and
   persists the row with `business_status=pending`.
2. Ogun dispatches to the provider (Safaricom or Paystack).
3. Ogun starts a 5-second poller with a **5-minute TTL**.
4. **Primary path**: the provider webhook arrives, Ogun marks the
   collection terminal (succeeded/failed), credits the wallet, fires
   the `collection.succeeded` or `collection.failed` webhook to you.
5. **Backup path**: if the webhook never arrives, the poller queries
   provider state every 5 seconds and resolves on the first conclusive
   result.
6. **Timeout path**: after 5 minutes with no conclusive state, Ogun
   marks the collection `timed_out` / `failed`. The wallet is NOT
   credited. You receive a `collection.failed` webhook.

This means you never need to call Ogun back to check on a collection
— the webhook is the source of truth.

## 5. Force a status check

If you need to force a provider status query (e.g. investigating a
stuck collection), call:

```bash
curl -sSL -X POST https://sandbox.ogun.com/v1/collections/col_.../sync \
  -H "Authorization: Bearer sk_test_..."
```

Rate limited to 1 call per collection per minute. Returns the detail
view with both statuses refreshed.

## 6. Refunds

Refund a successful collection fully or partially:

```bash
curl -sSL -X POST https://sandbox.ogun.com/v1/collections/col_.../refund \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{ "amount": 100000, "reason": "customer requested" }'
```

- **Full refund** (amount equals the collection amount) flips
  `business_status` to `refunded`.
- **Partial refund** keeps `business_status=successful` and sets
  `refund_status=partial_refund`. You can issue multiple partial
  refunds as long as the running total stays within the original
  amount.
- **Settlement-aware**: refunds against already-settled collections
  are applied as negative adjustments to the next settlement cycle.
  Refunds against unsettled collections debit the collection wallet
  directly.

## 7. Listing and filtering

```bash
# Paginated list, business_status filter, sub-merchant scope
curl -sSL "https://sandbox.ogun.com/v1/collections?status=successful&sub_merchant_id=smrc_...&page=1&limit=50" \
  -H "Authorization: Bearer sk_test_..."
```

Each list item returns `business_status`, `amount`, `fee_amount`,
`currency`, `method`, `provider`, `reference`, `sub_merchant_id`, and
`created_at`. No `internal_status` is exposed in list mode.

---

Next: [D. Payouts](./04-payouts.md)
