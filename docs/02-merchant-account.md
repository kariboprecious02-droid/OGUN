# B. Merchant Account

Every Ogun integration starts with a **merchant** and at least one
**sub-merchant**. Wallets, settlements, and fees are all scoped to
sub-merchants, so multi-location businesses get independent
accounting out of the box.

## Onboarding state machine

```
draft ──▶ submitted ──▶ under_ai_review ──▶ under_manual_review
                                             │
                                             ├─▶ approved ──▶ credentials_issued ──▶ active
                                             ├─▶ changes_requested ──▶ submitted (after resubmit)
                                             └─▶ rejected
```

`active` is a terminal state for successful onboarding. Merchants can
also be `suspended` from active and reactivated later.

## 1. Create the merchant

```bash
curl -sSL https://sandbox.ogun.com/v1/merchants \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "legal_name": "Kwara Kenya Ltd",
    "trading_name": "Kwara Kenya",
    "registration_number": "PVT-2024-12345",
    "tax_id": "P051234567A",
    "country": "KE",
    "settlement_currency": "KES",
    "business_category": "fintech",
    "business_address": {
      "street": "123 Moi Avenue",
      "city": "Nairobi",
      "county": "Nairobi",
      "postal_code": "00100"
    },
    "contact": {
      "name": "Cynthia Odhiambo",
      "email": "cynthia@kwara.co.ke",
      "phone": "+254700000000"
    }
  }'
```

Response: a fresh merchant in `draft` state with a `mrc_*` ID.

## 2. Create a sub-merchant

```bash
curl -sSL https://sandbox.ogun.com/v1/sub-merchants \
  -H "Authorization: Bearer sk_test_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "mrc_01KWARA...",
    "name": "Kwara Nairobi",
    "code": "KW-NBO-001",
    "settlement_preference": "weekly",
    "settlement_destination": {
      "bank_name": "Equity Bank",
      "account_number": "0123456789",
      "branch_code": "068"
    }
  }'
```

Each active sub-merchant gets its own collection wallet and payout
wallet on activation. Settlements run per-sub-merchant.

## 3. Upload compliance documents

Ogun's compliance pipeline expects four documents minimum:

- `certificate_of_registration`
- `tax_certificate` (KRA PIN certificate)
- `director_id` (national ID or passport)
- `bank_confirmation` (account statement or bank letter)

Upload each one as multipart/form-data:

```bash
curl -sSL https://sandbox.ogun.com/v1/merchants/mrc_01KWARA.../documents \
  -H "Authorization: Bearer sk_test_..." \
  -F "type=certificate_of_registration" \
  -F "file=@/path/to/cor.pdf"
```

Supported types: `certificate_of_registration`, `tax_certificate`,
`director_id`, `proof_of_address`, `bank_confirmation`,
`business_permit`, `authority_letter`, `other`.

Maximum file size: 15 MB. Uploads are only accepted while the merchant
is in `draft`, `changes_requested`, or `submitted` state.

## 4. Submit for compliance review

```bash
curl -sSL -X POST https://sandbox.ogun.com/v1/merchants/mrc_01KWARA.../submit \
  -H "Authorization: Bearer sk_test_..."
```

This kicks off Ogun's three-layer compliance pipeline (§4.2):

1. **Extraction** — each uploaded document is sent to a
   document-AI service (Google Document AI / AWS Textract in prod)
   that returns structured fields (company name, registration number,
   tax ID, etc.).
2. **Rules engine** — deterministic checks: mandatory documents
   present, KRA PIN format valid, registration number cross-matches
   the certificate, no expired documents, company name matches.
3. **Reasoning LLM** — Claude Opus 4.6 evaluates the combined
   extraction + rules output and produces a recommendation with
   structured flags.

The merchant transitions to `under_manual_review` once the pipeline
finishes. A human reviewer always has the final word.

## 5. Handle changes requested

If the reviewer requests changes, the merchant lands in
`changes_requested` state. The API response includes the flagged
sections. Re-upload the corrected document (same type; the latest
upload wins) and resubmit:

```bash
# Re-upload corrected certificate
curl -sSL https://sandbox.ogun.com/v1/merchants/mrc_.../documents \
  -F "type=certificate_of_registration" \
  -F "file=@/path/to/corrected.pdf"

# Resubmit
curl -sSL -X POST https://sandbox.ogun.com/v1/merchants/mrc_.../submit
```

## 6. Activation

Once the review comes back `approved`, an Ogun admin issues
credentials and activates the merchant. This is an ops operation
triggered from the Ogun dashboard, but for sandbox you can call:

```bash
curl -sSL -X POST https://sandbox.ogun.com/v1/admin/merchants/mrc_.../activate \
  -H "X-Ogun-Admin-Secret: your-admin-secret"
```

The response returns both sandbox and live credential sets. **Save
these — they are shown exactly once.**

On activation:
- Collection wallet created for each sub-merchant (balance 0)
- Payout wallet created for each sub-merchant (balance 0)
- `merchant.activated` webhook fires to all registered endpoints

## 7. Fund your payout wallet

Payout wallets start empty. Top up before issuing payouts:

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

Amount is in cents: 100_000_000 = KES 1,000,000.

---

Next: [C. Collections](./03-collections.md)
