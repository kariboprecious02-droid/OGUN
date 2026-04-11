# D. Payouts

Payouts move money **out** of your payout wallet to a beneficiary.
Ogun routes every payout through Paystack in production:

| Method | Internal method | Rail |
| --- | --- | --- |
| `mobile_money` | `paystack_mobile_money` | Paystack mobile money |
| `bank_transfer` | `paystack_kepss` | Paystack bank (KEPSS) |
| `demo` | `demo_payout` | Ogun simulator (sandbox only) |

Payouts are **API-first**. The dashboard is for observability and
reconciliation, not primary entry.

## 1. Fund the payout wallet

Payout wallets start at 0. Top up before any payout:

```bash
curl -sSL https://sandbox.ogun.com/v1/wallets/payout/topups \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "sub_merchant_id": "smrc_01NAI...",
    "amount": 100000000,
    "currency": "KES",
    "reference": "initial-topup"
  }'
```

Top-ups are idempotent — safe to retry.

## 2. Create a beneficiary (optional)

You can pass beneficiary details inline on every payout, but
registering them upfront lets Ogun cache the Paystack transfer
recipient code so you skip a round-trip per payout.

```bash
curl -sSL https://sandbox.ogun.com/v1/beneficiaries \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "merchant_id": "mrc_01KWARA...",
    "sub_merchant_id": "smrc_01NAI...",
    "name": "John Vendor",
    "beneficiary_type": "mobile_money",
    "mobile_number": "+254712345678",
    "currency": "KES"
  }'
```

## 3. Create a payout

```bash
curl -sSL https://sandbox.ogun.com/v1/payouts \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "merchant_id": "mrc_01KWARA...",
    "sub_merchant_id": "smrc_01NAI...",
    "amount": 50000,
    "currency": "KES",
    "method": "mobile_money",
    "beneficiary": {
      "name": "John Vendor",
      "mobile_number": "+254712345678"
    },
    "reference": "vendor-payment-001"
  }'
```

Response:

```json
{
  "status": "success",
  "data": {
    "payout_id": "pay_01H...",
    "status": "queued",
    "amount": 50000,
    "fee_amount": 500,
    "total_debit": 50500,
    "recipient_amount": 50000,
    "fee_model": "merchant_covers",
    "provider": "paystack",
    "reference": "vendor-payment-001"
  }
}
```

## 4. Fee models

### merchant_covers (default)

The merchant pays the fee. The recipient gets the full `amount`; the
platform fee is debited from the merchant's payout wallet.

```
amount           = 1000    (KES 10.00 payout)
fee_amount       = 100     (1% fee)
total_debit      = 1100    (wallet debited amount + fee)
recipient_amount = 1000    (recipient gets full amount)
```

### recipient_covers

The recipient pays the fee. The merchant's wallet is debited for
`amount` only, and the recipient's net is `amount - fee`.

```
amount           = 1000
fee_amount       = 100
total_debit      = 1000    (wallet debited amount only)
recipient_amount = 900     (recipient gets amount - fee)
```

Recipient-covers is commercially gated — you choose it via merchant
settings, not per request.

## 5. The reservation model

When a payout is created, Ogun **reserves** `total_debit` from the
payout wallet as a single atomic ledger entry. This ensures:

- You can't accidentally double-spend by issuing two payouts from the
  same balance before the first one resolves.
- A failed payout can be cleanly reversed — the reservation is
  released back to `available_balance` in one entry.
- A successful payout finalizes with **two separate ledger entries**:
  `payout_principal_debit` and `payout_fee_debit`. This lets you
  report on platform fees independently from principal outflows.

The wallet invariant is verified hourly by Ogun's ledger reconciliation
worker (§13.4). Any drift between stored balances and derived ledger
sums is logged and pages the on-call team.

## 6. Lifecycle

```
created ──▶ queued ──▶ processing ──▶ pending_approval ──▶ pending_confirmation ──▶ succeeded
                                                                                    │
                                                                                    └──▶ reversed
                          ├──▶ failed (releases reservation)
                          └──▶ cancelled (pre-dispatch)
```

- `pending_approval` only applies to Paystack mobile money that
  requires OTP confirmation.
- `reversed` is a post-success state. Ogun credits the principal back
  to the wallet with `payout_reversal_credit`. Fee reversal is
  policy-gated (ops-reviewed in MVP).

## 7. Insufficient balance

If `available_balance < total_debit`, the payout fails **before** any
provider call is made. You get `422 insufficient_payout_balance` with
the current wallet balance in `error.details`:

```json
{
  "error": {
    "code": "insufficient_payout_balance",
    "details": {
      "available_balance": 45000,
      "required": 50500
    }
  }
}
```

Top up and retry.

## 8. Detail vs list view

- `GET /v1/payouts` returns `status` only. No `provider_status`.
- `GET /v1/payouts/:id` returns both `status` (Ogun-normalized) and
  `provider_status` (raw Paystack value) for debugging.
- `POST /v1/payouts/:id/sync` forces a provider status check.
  Rate-limited 1/min/payout.

---

Next: [E. Settlements](./05-settlements.md)
