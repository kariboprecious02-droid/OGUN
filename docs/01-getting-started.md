# A. Getting Started

Ogun is a payment infrastructure platform for Kenyan businesses. This
section gets you from zero to your first authenticated API call.

## 1. Environments

| Env | Base URL | Key prefix |
| --- | --- | --- |
| Sandbox | `https://sandbox.ogun.com/v1` | `sk_test_`, `pk_test_`, `whsec_test_` |
| Production | `https://api.ogun.com/v1` | `sk_live_`, `pk_live_`, `whsec_live_` |

Sandbox and production are fully isolated: merchants, sub-merchants,
wallets, and credentials do not cross between them. The demo
simulator is only available in sandbox.

## 2. Authentication

Every authenticated request carries a Bearer token in the
`Authorization` header:

```http
Authorization: Bearer sk_live_abc123...
```

- **`sk_*` secret keys** — required for all mutating endpoints
  (POST, PATCH, PUT, DELETE). Treat them like database passwords.
- **`pk_*` publishable keys** — safe to use in frontend code for
  read-only operations. Attempting a mutating endpoint with a
  publishable key returns `403 forbidden`.
- **`whsec_*` webhook secrets** — not used for API calls. Used by
  Ogun to sign outbound webhook payloads so you can verify
  authenticity.

Credentials are issued on merchant activation (see §B). Rotate them
via `POST /v1/merchants/:id/api-keys/rotate`.

## 3. Idempotency

Every POST endpoint accepts (and most require) an `Idempotency-Key`
header — any UUID is fine, but it must be unique per logical
operation.

```http
POST /v1/collections HTTP/1.1
Authorization: Bearer sk_test_abc...
Idempotency-Key: 7f6a2b6e-8f0b-4e3a-9d8c-12de2a1b7c9a
Content-Type: application/json
```

- **Same key + same body** returns the cached `201 Created` response.
  Safe to retry on timeout.
- **Same key + different body** returns `409 idempotency_conflict`.
  This catches programmer errors (accidentally reusing a key with a
  different payload).
- **Keys live for 24 hours** in the cache. After that they're
  discarded and can be reused.

## 4. Response envelope

All successful responses share this shape:

```json
{
  "status": "success",
  "data": { ... },
  "meta": { "request_id": "req_01H..." }
}
```

Errors share this one:

```json
{
  "status": "error",
  "error": {
    "code": "invalid_request",
    "message": "amount must be positive",
    "details": { "field": "amount" }
  },
  "meta": { "request_id": "req_01H..." }
}
```

Always surface `request_id` in your logs — it's the fastest way to
correlate support tickets with server-side traces.

## 5. cURL smoke test

Once you have a sandbox secret key:

```bash
curl -sSL https://sandbox.ogun.com/v1/wallets \
  -H "Authorization: Bearer sk_test_your_key_here"
```

Expected response: a list of your collection + payout wallets (one
per active sub-merchant). If you get `401`, your key is wrong. If you
get `200` with an empty array, your merchant isn't active yet — walk
through §B to finish onboarding.

## 6. Next steps

- **Just want to integrate?** → [C. Collections](./03-collections.md)
- **Need to onboard a new merchant?** → [B. Merchant Account](./02-merchant-account.md)
- **Already have transactions to reconcile?** → [F. Webhooks](./06-webhooks.md)
