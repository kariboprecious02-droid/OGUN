# E. Settlements

Settlements move funds from your **collection wallet** to your bank
account on a schedule. Ogun settles **per sub-merchant** — no
cross-sub-merchant aggregation.

## 1. Eligibility rules

A collection is eligible for settlement only if:

- `business_status = 'successful'`
- `settlement_eligible = true`
- Not already settled (`settlement_batch_id IS NULL`)

`pending` and `failed` collections never settle. `refunded`
collections create a **negative adjustment** against the next
settlement cycle (if already settled) or are removed from eligibility
(if not yet settled).

## 2. Settlement calculation

```
eligible           = SUM(collection.amount WHERE eligible)
fees               = SUM(collection.fee_amount WHERE eligible)
settlement_fee     = ROUND(eligible * settlement_fee_pct / 100)
refund_adjustments = SUM(refund_amount for refunds posted since last settlement)
net                = eligible - fees - settlement_fee - refund_adjustments
```

The net amount is debited from the collection wallet and moved to the
payout wallet (via the settlement → payout rail) and then dispatched
to the sub-merchant's configured bank account.

## 3. Create + execute a settlement

```bash
curl -sSL https://sandbox.ogun.com/v1/settlements \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "merchant_id": "mrc_01KWARA...",
    "sub_merchant_id": "smrc_01NAI...",
    "mode": "on_demand"
  }'
```

Response includes the batch summary:

```json
{
  "status": "success",
  "data": {
    "id": "stl_01H...",
    "gross": 295500,
    "fees": 4500,
    "settlement_fee": 0,
    "refund_adjustments": 0,
    "net": 291000,
    "transaction_count": 3,
    "status": "paid"
  }
}
```

## 4. What executes on settlement success

1. **Ledger debit**: `settlement_debit` entry on the collection wallet
   for the net amount.
2. **Payout wallet top-up**: net + fee amount credited to the payout
   wallet as a `payout_wallet_topup_credit`.
3. **Payout dispatch**: Ogun creates a real payout via the Payout
   Orchestrator with the sub-merchant's
   `settlement_destination` as the beneficiary. The resulting payout
   ID is linked to `settlements.payout_id`.
4. **PDF report**: an A4 PDF report is rendered and persisted to
   storage. `settlements.report_url` is updated.
5. **Email**: the report is emailed as an attachment to the merchant's
   configured notification recipients.
6. **Webhook**: `settlement.paid` fires with the settlement summary
   + `report_url`.

## 5. Retrieve the report

```bash
curl -sSL https://sandbox.ogun.com/v1/settlements/stl_.../report \
  -H "Authorization: Bearer sk_test_..."
```

Response:

```json
{
  "status": "success",
  "data": {
    "report_url": "https://storage.ogun.com/...",
    "expires_at": "2026-04-05T10:45:00Z"
  }
}
```

URLs expire after 15 minutes; re-call the endpoint to get a fresh
presigned URL.

## 6. Schedules

Set a schedule on each sub-merchant:

```bash
curl -sSL -X PATCH https://sandbox.ogun.com/v1/sub-merchants/smrc_.../ \
  -d '{ "settlement_preference": "daily" }'
```

Options: `daily`, `weekly`, `monthly`, `on_demand`. The scheduled
variants run automatically via Ogun's cron; `on_demand` disables the
cron and requires you to hit `POST /v1/settlements` manually.

## 7. Failed settlements

Settlement execution fails cleanly when the collection wallet has
insufficient balance (e.g. a rush of refunds just before a
settlement run). The settlement row transitions to `failed`, no
collection wallet debit is posted, and you receive a
`settlement.failed` webhook with `failure_reason: "insufficient_collection_balance"`.

Ops retry manually after investigating — the MVP deliberately does
not auto-retry because insufficient balance usually indicates a real
accounting issue.

---

Next: [F. Webhooks](./06-webhooks.md)
