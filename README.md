# Ogun — Payment Infrastructure Platform

**Kenya-first · Sub-merchant native · API-first payouts**
Derived from Ogun Execution Spec v4.1.0 (Strategic PRD v2.0 authority).

Ogun is a modular-monolith payment platform that collects via Safaricom
M-Pesa (Daraja direct) and Paystack (Airtel + other rails), and pays out
via Paystack (mobile money + bank transfer / KEPSS). Each active
sub-merchant owns its own collection and payout wallet; settlement is
per-sub-merchant.

## Locked MVP decisions

| Decision | Value |
| --- | --- |
| M-Pesa collections | Safaricom Daraja **direct** |
| Airtel collections | Paystack |
| Payouts | Paystack (mobile money + bank KEPSS) |
| Payout initiation | **API-first** |
| Wallet ownership | **Sub-merchant level** |
| Settlement | Independent per sub-merchant |
| Polling | 5 s intervals, 5 min TTL, timeout → `failed` |
| Business states | `pending` / `successful` / `failed` / `refunded` |
| Detail view | Shows **both** `business_status` and `internal_status` |
| List view | Shows `business_status` **only** |
| Fee models | `recipient_covers` / `merchant_covers` |
| Webhook headers | `X-Ogun-Signature`, `X-Ogun-Timestamp`, `X-Ogun-Event-Id` |
| Architecture | Modular monolith, outbox pattern, append-only ledger |

## Repository layout

```
src/
  infra/                      # cross-cutting: db, redis, logger, crypto, ids, errors
    db/migrations/            # SQL migrations (ordered)
  modules/
    auth/                     # API key issuance, Bearer validation
    merchant/                 # merchants, sub-merchants, settings, state machine
    compliance/               # 3-layer pipeline: extraction + rules + reasoning
    wallet/                   # wallets + immutable ledger (postLedgerEntry)
    collection/               # Collection Orchestrator (dual-state model, fees)
    payout/                   # Payout Orchestrator (reservation, fee models)
    settlement/               # Per-sub-merchant settlement engine
    connectors/               # Safaricom, Paystack (coll + payout), Demo
    polling/                  # 5 s / 5 min TTL poller
    webhook/                  # Outbound webhook dispatch with X-Ogun-* headers
  api/
    app.ts                    # Express wiring
    middleware/               # requestContext, authenticate, idempotency, errors
    routes/                   # merchants, collections, payouts, wallets,
                              # settlements, admin, inbound webhooks
  server.ts                   # Entrypoint + background workers (poller + webhook dispatch)
```

## Getting started

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    (edit DATABASE_URL, REDIS_URL, SAFARICOM_*, PAYSTACK_*)

# 3a. Bring up the full local stack (Postgres + Redis + migrate + seed)
./bin/dev-up.sh
#    (requires Docker; uses docker-compose.yml)

# 3b. OR run against your own Postgres / Redis
npm run migrate
npm run seed     # creates the Kwara Kenya anchor merchant, prints sandbox keys

# 4. Start the server + background workers
npm run dev
```

## Tests

Two modes:

```bash
# Unit tests — no external dependencies, run anywhere
npm test

# Unit + integration — requires a running Postgres + Redis
DATABASE_URL=postgres://ogun:ogun@localhost:5432/ogun_test \
REDIS_URL=redis://localhost:6379/1 \
npm run test:integration
```

Integration suites (`*.integration.test.ts`) exercise the orchestrators
end-to-end against real services, including the §3.5 wallet invariant,
the dual-state collection model, and the payout reservation flow.
They're skipped automatically when `RUN_INTEGRATION` is not set.

## Critical architecture invariants

1. **Immutable ledger** — every wallet mutation is an `INSERT` into
   `ledger_entries` with a unique `idempotency_key`. Wallet balances are
   derived from ledger state; see `src/modules/wallet/ledger.ts`.
2. **Wallet invariant** — `available_balance = Σ posted (non-reserved)
   ledger entries`; `reserved_balance = Σ payout_reserve − payout_release
   − payout_*_debit`. Verified by `deriveWalletBalance` and reconciled hourly.
3. **Dual-state model** — collections and payouts carry an
   `internal_status` (lifecycle) and a normalized public `business_status`
   / `status`. List endpoints return only the public field; detail
   endpoints return both.
4. **Webhook-first, poller backup** — on provider submission we enqueue a
   5-second poller with a 5-minute TTL. Before every poll we check for a
   terminal state or `webhook_received_at`; either stops the poller early.
   Five minutes with no conclusive result ⇒ `internal_status=timed_out`,
   `business_status=failed`, wallet untouched.
5. **Reservation model** — `total_debit` is reserved on payout create.
   Success → `payout_principal_debit` + `payout_fee_debit` (separate,
   traceable entries). Failure → `payout_release` for the full reserved
   amount. Reversal → `payout_reversal_credit` (fee reversal is policy-gated
   in MVP).
6. **Idempotency** — `Idempotency-Key` header is required on all POST
   routes that mutate state. Same key + same body returns the cached
   response. Same key + different body returns `409 idempotency_conflict`.
7. **Connector abstraction** — every PSP implements the same interface
   (`CollectionConnector` / `PayoutConnector`). Adding a provider is a
   new file in `src/modules/connectors/`, not a rewrite of orchestration.

## Compliance pipeline

The 3-layer pipeline runs in `runCompliancePipeline`:

1. **Extraction** (`extraction.service.ts`) — pluggable interface for
   Google Document AI / AWS Textract / Azure Form Recognizer. MVP ships a
   deterministic stub.
2. **Rules engine** (`rules.engine.ts`) — pure TypeScript predicates.
   Each failure is a hard flag regardless of LLM output. Rules:
   `mandatory_docs`, `tax_id_format`, `registration_cross_match`,
   `document_expiry`, `company_name_cross_match`.
3. **Reasoning** (`reasoning.service.ts`) — reasoning-LLM adapter that
   consumes the rule results and extraction output and emits a structured
   recommendation (`approve` / `needs_review` / `reject`) with flags.

Human reviewers always have the final word via
`POST /v1/admin/compliance-reviews/:merchantId`.

## API surface (summary)

| Method | Endpoint | Notes |
| --- | --- | --- |
| POST | `/v1/merchants` | Create merchant (draft) |
| PATCH| `/v1/merchants/:id` | Update whitelisted profile fields |
| GET  | `/v1/merchants/:id/settings` | Effective fee + method settings |
| PATCH| `/v1/merchants/:id/settings` | Merchant-level settings override |
| POST | `/v1/merchants/:id/api-keys/rotate` | Rotate the secret key |
| POST | `/v1/merchants/:id/webhook-secret/rotate` | Rotate the webhook secret |
| POST | `/v1/merchants/:id/documents` | Multipart upload (certificate of reg, KRA, ID, etc.) |
| GET  | `/v1/merchants/:id/documents` | List uploaded documents |
| POST | `/v1/sub-merchants` | Create sub-merchant |
| PATCH| `/v1/sub-merchants/:id` | Update sub-merchant profile |
| PATCH| `/v1/sub-merchants/:id/settings` | Sub-merchant settings override |
| POST | `/v1/merchants/:id/submit` | Submit for compliance pipeline |
| POST | `/v1/admin/compliance-reviews/:id` | Human decision |
| POST | `/v1/admin/merchants/:id/activate` | Issue credentials + create wallets |
| POST | `/v1/collections` | Create collection (async; poll + webhook backed) |
| GET  | `/v1/collections` | List (business_status only) |
| GET  | `/v1/collections/:id` | Detail (business_status **+** internal_status) |
| POST | `/v1/collections/:id/sync` | Force provider status check (1/min rate limit) |
| POST | `/v1/collections/:id/refund` | Full or partial refund with settlement adjustment |
| POST | `/v1/payouts` | Create payout (reservation + Paystack dispatch) |
| GET  | `/v1/payouts` | List (status only) |
| GET  | `/v1/payouts/:id` | Detail (status **+** provider_status) |
| POST | `/v1/payouts/:id/sync` | Force provider status check (1/min rate limit) |
| POST | `/v1/beneficiaries` | Create a beneficiary (+ optional Paystack recipient) |
| GET  | `/v1/beneficiaries` | List beneficiaries for the merchant |
| GET  | `/v1/beneficiaries/:id` | Get beneficiary detail |
| PATCH| `/v1/beneficiaries/:id` | Update beneficiary |
| DELETE| `/v1/beneficiaries/:id` | Delete beneficiary |
| POST | `/v1/wallets/payout/topups` | Fund payout wallet |
| GET  | `/v1/wallets` | Balances |
| POST | `/v1/webhook-endpoints` | Register a webhook URL (returns secret once) |
| GET  | `/v1/webhook-endpoints` | List registered endpoints |
| GET  | `/v1/webhook-endpoints/:id` | Endpoint detail |
| PUT  | `/v1/webhook-endpoints/:id` | Update (url, events, is_active) |
| DELETE| `/v1/webhook-endpoints/:id` | Delete |
| POST | `/v1/webhook-endpoints/:id/test` | Queue a synthetic test delivery |
| POST | `/v1/settlements` | On-demand settlement for a sub-merchant |
| POST | `/v1/webhooks/safaricom` | Inbound Daraja callback |
| POST | `/v1/webhooks/paystack` | Inbound Paystack webhook |

All success responses share `{ status, data, meta }`; errors share
`{ status: "error", error: { code, message }, meta }`. See
`src/infra/response.ts` and `src/infra/errors.ts`.

## Running the tests

```bash
npm test
```

The unit tests cover:

- Collection & payout fee calculations (§5.7 / §6.4) — both models, both sides
- Merchant onboarding state machine (§4.1)
- Collection dual-state mapping (§5.2)
- Payout terminal-state detection (§6.1)
- Compliance rules engine (§4.2.2)
- Ledger delta invariants (§3.5 / §2.4) — end-to-end fee + reservation scenarios
- Error envelope & HTTP status mapping (§10.2 / §11.2)

## Production readiness

The backend MVP now ships with:
- **Real Claude wiring** for compliance reasoning (`ANTHROPIC_API_KEY`
  gated, falls back to a deterministic rule-driven stub in tests and
  sandbox). Prompt caching is enabled on the system prompt.
- **Settlement PDF reports** rendered via pdfkit, persisted through the
  storage adapter, emailed to configured notification addresses, and
  served via `GET /v1/settlements/:id/report`.
- **Settlement → payout rail**: on `executeSettlement`, funds are moved
  from the collection wallet to the payout wallet (including fee
  pre-funding) and a real payout is created through the Payout
  Orchestrator so the reservation + ledger logic stays the single
  source of truth. `settlements.payout_id` is linked on success.
- **BullMQ worker mode**: start the server with `OGUN_WORKERS=1` and
  the poller tick + webhook delivery jobs run as BullMQ workers
  against Redis instead of in-process setIntervals. The in-process
  fallback is retained for tests and single-node dev.
- **Email adapter**: `ConsoleEmailAdapter` for dev (logs), `SendGrid`
  stub for prod, and a `CaptureEmailAdapter` for tests.
- **Per-endpoint webhook signing**: each webhook endpoint stores its
  own AES-256-GCM encrypted secret and outbound deliveries are signed
  with that endpoint-specific key, not a platform-wide salt.
- **Ledger reconciliation worker** (§3.5 / §13.4): `reconcileAllWallets()`
  compares stored balances against derived ledger sums for every
  wallet, logs drift at ERROR, and persists drift events to
  `ledger_drift_events` for ops review. Read-only by design — never
  auto-corrects.
- **Prometheus /metrics endpoint** with request counters and
  duration histograms. Lightweight in-process implementation; no
  external dependencies. Scrape-compatible with Grafana / Mimir.
- **Full §9 demo simulator** covering all seven scenarios (001–007)
  including the 5-minute TTL timeout path.
- **Developer Academy** at [`/docs`](./docs/README.md) with all §11
  sections (getting started, onboarding, collections, payouts,
  settlements, webhooks, testing, errors).

- **Google Document AI integration** for Layer 1 compliance extraction
  (§4.2.1). Adapter pattern with env-gated fallback to the
  deterministic stub — set `GOOGLE_DOCUMENTAI_PROJECT_ID`,
  `GOOGLE_DOCUMENTAI_PROCESSOR_ID`, and `GOOGLE_APPLICATION_CREDENTIALS`
  to flip it on. See [`docs/09-google-document-ai.md`](./docs/09-google-document-ai.md)
  for the full setup.

- **Admin dashboard** — Next.js 14 app at `apps/admin/` with
  server-component-only pages, cookie-based admin auth, compliance
  review queue + detail screen with AI recommendation and
  approve/request-changes/reject form, merchant activation flow,
  wallet inspector with ledger drill-down, and dual-state collection +
  payout browsers. The admin secret stays in an httpOnly cookie and
  never reaches the browser.

  ```bash
  cd apps/admin
  npm install
  OGUN_API_BASE_URL=http://localhost:4000/v1 npm run dev
  # Dashboard at http://localhost:4001 — log in with the value of
  # OGUN_WEBHOOK_SIGNING_SALT from your Ogun backend env.
  ```

Remaining P2 items (not blocking backend MVP acceptance):
- Live Safaricom Daraja / Paystack credentials in CI
