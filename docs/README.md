# Ogun Developer Academy

**Kenya-first payment infrastructure for builders.**
M-Pesa via Safaricom Daraja · Airtel Money + bank payouts via Paystack.

This is the official Ogun Developer Academy. Every page walks you
through a complete integration task — from creating a merchant account
to going live with M-Pesa collections and API-first payouts.

## Contents

| Section | What you learn |
| --- | --- |
| [A. Getting Started](./01-getting-started.md) | Sandbox vs production, Bearer auth, Idempotency-Key, response envelopes |
| [B. Merchant Account](./02-merchant-account.md) | Create merchant, upload docs, walk the compliance pipeline, get credentials |
| [C. Collections](./03-collections.md) | M-Pesa and Airtel collection flows, dual-state model, refunds |
| [D. Payouts](./04-payouts.md) | API-first payouts, wallet funding, beneficiaries, fee models |
| [E. Settlements](./05-settlements.md) | Lifecycle, per-sub-merchant eligibility, PDF reports |
| [F. Webhooks](./06-webhooks.md) | X-Ogun-* headers, HMAC-SHA256 verification, replay safety |
| [G. Testing](./07-testing.md) | All §9 demo scenarios, webhook simulator, sandbox tips |
| [H. Errors & Failure Reasons](./08-errors.md) | Error codes, failure reasons, retry semantics |
| [I. Google Document AI](./09-google-document-ai.md) | Enabling live document extraction for the compliance pipeline |

## Core principles

These are locked across every endpoint. Understanding them makes
Ogun easy to reason about.

1. **Idempotent POSTs** — every POST takes an `Idempotency-Key` header
   (UUID). Same key + same body returns the cached response. Different
   body returns `409 idempotency_conflict`.
2. **Dual-state model** — list views return a normalized
   `business_status`; detail views return both `business_status` and
   `internal_status` so you can reconcile against provider state.
3. **Webhook-first, poller backup** — Ogun trusts provider webhooks
   but pre-emptively polls every 5 seconds until a terminal state is
   reached. After 5 minutes of no conclusive result, collections are
   marked `failed` and wallets are untouched.
4. **Reservation payouts** — payouts reserve `total_debit` at create
   time. Success finalizes principal + fee as separate ledger entries.
   Failure releases the entire reservation.
5. **Immutable ledger** — every wallet mutation is an append-only
   ledger entry with an idempotency key. Balances are derived; never
   mutated directly.

## Reference

- **OpenAPI spec**: [`openapi.yaml`](../openapi.yaml)
- **Execution spec**: Section numbers referenced throughout these
  docs (e.g. §5.4) refer to the Ogun Execution Spec v4.1.0.
- **Locked decisions**: See §1.1 in the Execution Spec for the full
  list of product constraints.

## Support

- Production: `https://api.ogun.com/v1`
- Sandbox:    `https://sandbox.ogun.com/v1`
- Issues: <https://github.com/kariboprecious02-droid/OGUN/issues>
