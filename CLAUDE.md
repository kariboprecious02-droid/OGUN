# CLAUDE.md — OGUN repo guidance

Guidance for any Claude Code session opened against this repository.

## Read first: collections-path observability audit

Before touching anything in `src/modules/collection/`, `src/modules/connectors/paystack.*`, `src/modules/polling/`, `src/modules/webhook/`, or `src/api/routes/collections.routes.ts`, **read [`docs/observability-audit/observability-audit.md`](docs/observability-audit/observability-audit.md)**.

It is the canonical source of truth for:

- The complete inventory of log statements on the collections path (there are seven; five are error-only catches)
- Why `provider_call_state: timed_out` rows do not currently enqueue a polling job (`collection.service.ts:227` gates polling on `next_action !== null`)
- The three-layer fix proposal: **L1** axios interceptors + structured logs · **L2** new `collection_events` table · **L3** Transaction Detail View in `ogun-admin`
- The PR plan in §7 (PR-1 bundles L1+L2; PR-2 fixes the polling-gate; PR-3 ships the admin view)
- The mock for L3 — a self-contained HTML file at [`docs/observability-audit/transaction-detail-view-mock.html`](docs/observability-audit/transaction-detail-view-mock.html) that opens in any browser

Audit subject: this repo @ commit `d8ec2d4` (Paystack-default, spec §4.7 sync response).

## PRs are sequenced

When implementing the recommendations, follow the order in §7 unless PK has decided otherwise:

1. **PR-1** — Lifecycle observability foundation (L1 + L2 bundled). Migration `00NN_collection_events.sql` + axios interceptors on both Paystack connectors + structured `recordCollectionEvent` calls at every lifecycle gate. Acceptance criteria are in §7 PR-1.
2. **PR-2** — Polling-gate behavior fix. Two options pending PK sign-off: **Option A** (enqueue polling on `timed_out` with `provider_reference: null` and let the 5-min TTL resolve) vs **Option B** (reclassify the outer-catch path as `provider_call_state: 'error'` — requires §4.7 spec change). Audit recommends shipping A first, then B with the rest of the §4.7 cleanup.
3. **PR-3** — Admin Transaction Detail View v0 in `ogun-admin` (separate repo). Three sections: 7-step journey stepper (Created → Settled), EBANX-inspired partner-interaction tabs (Integration Logs / Webhook Logs), wallet impact. Read-only, merchant-scoped. The HTML mock is the visual spec.

## Spec dependencies

The audit references `openapi.yaml` §4.7 (`provider_call_state`, `next_action`, `provider_message`, `failure_reason`) and §7 (settlement layer — `createSettlement` → `executeSettlement` → `dispatchSettlementPayout`). `Settled` is the **true final state** of a collection — wallet credit is mid-journey.

## Out of scope (do not regress)

- The audit is read-only. Do not "fix" the polling-gate by mutating `collection.service.ts` without a corresponding `collection_events` write — silent fixes regress observability.
- Do not log raw provider request/response bodies without redacting `Authorization` headers and PII (phone, email). Sample redaction lives in §5 L1 of the audit.
- Do not collapse the 7-step journey stepper to 6 steps. `Settled` (`settlement_batch_id IS NOT NULL` joined with `settlements.status = 'paid'`) is its own step per `settlement.service.ts`.

## Other guidance

- Tests: integration tests against the collections path must hit a real DB (not mocks) — see prior incident around mock/prod migration divergence.
- Migrations: append-only, never edit a previously-shipped migration file.
- Cloud Run config: `DATABASE_URL` is per-service; do not bind admin secrets or signing salts to the admin frontend service (it's a pure relay).
