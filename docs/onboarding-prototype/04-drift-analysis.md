# Ogun onboarding prototype — Ultrareview

**Prototype:** `ogun-onboarding-prototype.html` (v1.2.2)
**Backend baseline:** `OGUN/` — commit under `/sessions/nifty-keen-albattani/OGUN/`
**Reviewer:** Optimus Prime / CoS
**Date:** 2026-04-24
**Purpose:** Produce a plug-and-play merge checklist for Claude Code. Every drift below is grounded in the actual backend file + line so Claude Code can patch the prototype without guessing.

---

## 0. TL;DR — what's aligned, what has to change before merge

**Already aligned (keep as-is):**

- 6-step journey (People & Docs → Profile → Settings → AI Compliance → Review → Activate).
- Sub-merchants as a Settings CTA that duplicates parent methods/fees/settlement/docs. Backend supports this natively: `merchant_settings.sub_merchant_id` and `documents.sub_merchant_id` are both nullable — NULL = inherited from parent. Migration 0002 has partial unique indexes that enforce "one merchant-level row, one override per sub".
- Settlement preferences: `daily | weekly | monthly | on_demand`. Matches `sub_merchants.settlement_preference` enum (`merchants.routes.ts:93,178`).
- Fee models: `collection_fee_model ∈ {merchant_covers, payer_covers}`, `payout_fee_model ∈ {merchant_covers, recipient_covers}`. Matches `settingsBody` zod schema (`merchants.routes.ts:215-217`).
- Default fees (1.5 % collections / 1.0 % payouts / 0 % settlement) and `enabled_methods: text[]` where `till` is forward-compatible — all legal in the backend.
- Atomic activate: POST `/admin/merchants/:id/activate` issues credentials, transitions merchant to `active`, activates subs, creates wallets in one call (`admin.routes.ts:124-141`). Prototype's single Activate CTA is correct.
- Review decisions `approve | reject` map 1:1.
- Admin secret via `X-Ogun-Admin-Secret` header + httpOnly cookie is the right auth model (`apps/admin/lib/api.ts:22, 48-58`).
- Pagination envelope `{items, page, limit, total}` matches `paginated()` helper (`admin.routes.ts:221`).

**Must-fix drift (8 items, all trivial strings/renames except #8):**

| # | Prototype says | Backend expects | Where |
|---|---|---|---|
| 1 | `kyb_in_progress`, `kyb_approved`, `settings_configured`, `ready_for_activation` as merchant statuses | `draft`, `submitted`, `under_ai_review`, `under_manual_review`, `changes_requested`, `approved`, `rejected`, `credentials_issued`, `active`, `suspended` | `modules/merchant/merchant.types.ts:9-20` |
| 2 | `review.decision === "changes"` | `"changes_requested"` | `api/routes/admin.routes.ts:33-37` |
| 3 | Doc keys `certificate_of_incorporation`, `kra_pin`, `cr12`, `business_address_proof` | `certificate_of_registration`, `tax_certificate`, *(none for CR12)*, `proof_of_address` | `modules/document/document.service.ts:23-32` |
| 4 | `merchant.kra_pin` field | `merchant.tax_id` | `modules/merchant/merchant.types.ts:47` |
| 5 | Attestation checkbox as flow gate | No attestation column or endpoint — UI-only gate | (no backend reference) |
| 6 | Sub-merchant `display_name`, `status: "sub-draft"` | `name`, `status ∈ {draft, active, suspended, closed}` | `modules/merchant/merchant.types.ts:63-76` |
| 7 | Prototype stores KES amounts as floats (`150000` = 150,000 KES) | Backend stores amounts in **minor units** (cents) as `bigint` | see `apps/admin/app/compliance/new/page.tsx:11-17` (`kesToCents`) |
| 8 | Admin uploads documents + submits for review from dashboard | Backend doc upload + submit **require merchant secret key** (not admin secret) — needs new admin routes OR split UI into admin + merchant | `api/routes/documents.routes.ts:49`, `api/routes/merchants.routes.ts:73-87` |

Item #8 is the only architectural decision. Everything else is a find-and-replace.

---

## 1. Per-step drift table — prototype → backend truth

### Step 1 — People & Documents

| Prototype field | Prototype value / key | Backend counterpart | Drift |
|---|---|---|---|
| Doc key `certificate_of_incorporation` | uploaded via `/uploads` POST in prototype | `certificate_of_registration` | **Rename key in app.jsx + all references.** Backend enum is closed (`document.service.ts:23`). |
| Doc key `cr12` (director list) | Kenya-specific CR12 | *No direct backend match* — closest is `director_id` (per-director) | **Replace with per-director `director_id` uploads**, one row per director. Prototype already has per-director upload slots in Step 1 (`app.jsx:836, 1178`) — just drop the `cr12` entry from `requiredCompanyDocs`. |
| Doc key `kra_pin` | tax certificate | `tax_certificate` | **Rename key.** |
| Doc key `business_address_proof` | utility bill / lease | `proof_of_address` | **Rename key.** |
| — | — | Also supported: `bank_confirmation`, `business_permit`, `authority_letter`, `other` | Consider adding `bank_confirmation` as required alongside settlement account capture. |
| Extraction auto-fill | Simulated client-side `EXTRACTED_FROM` map | Backend writes `documents.extracted_data` jsonb + `extraction_confidence` after Document AI runs server-side | UI can keep the optimistic auto-fill pattern but must **poll or receive `extracted_data`** from `GET /admin/merchants/:id` (`admin.routes.ts:234-316`) which returns docs with `extracted_data`. |
| Upload state gate | `documents[key].status === "uploaded"` local | Backend allows uploads only in `draft | submitted | changes_requested` (`document.service.ts:45-49`) | Map prototype state: guard upload CTA when merchant status ∉ those three. |

### Step 2 — Profile

| Prototype field on `merchant` | Backend column | Drift |
|---|---|---|
| `legal_name` | `legal_name` | ✅ match |
| `trading_name` | `trading_name` | ✅ match |
| `registration_number` | `registration_number` | ✅ match |
| `kra_pin` | `tax_id` | **Rename.** The API accepts `tax_id` (`merchants.routes.ts:30, 149`). Rename in prototype state, placeholders, and extraction mapping. |
| `business_address` | `business_address jsonb` | ✅ match — just pass through the object. |
| `contact.{name,email,phone}` | `contact_name, contact_email, contact_phone` (columns) + `contact: {name,email,phone}` (create body) | Create body accepts nested; PATCH accepts flat. Use the create-body shape on POST, flat shape on PATCH. |
| Directors table | Not a merchant column | Directors live **implicitly** via `director_id` documents + their `extracted_data`. Do not try to POST them; read them back from doc extraction. |

### Step 3 — Settings

All aligned. Confirmed:

- `collection_fee_pct` / `payout_fee_pct` / `settlement_fee_pct` — `number, nonnegative` (`merchants.routes.ts:213-221`). Prototype stores `1.5`, `1.0`, `0.1` — fine.
- `collection_fee_model ∈ {merchant_covers, payer_covers}` — exact match.
- `payout_fee_model ∈ {merchant_covers, recipient_covers}` — exact match.
- `enabled_methods: text[]` — prototype stores as `{mpesa, airtel, till, card, bank}` bool-map; flatten to array on save: `Object.entries(settings.enabled_methods).filter(([,on])=>on).map(([k])=>k)`.
- `notification_emails: string[]` — already an array capable field in backend; prototype has `merchant.notification_emails` slot.
- **Settlement destination & frequency are sub-merchant properties**, not merchant settings (`sub_merchants.settlement_preference` + `sub_merchants.settlement_destination jsonb`, see `merchant.types.ts:69-70`). The prototype's "parent account" is the primary (first) sub-merchant under the hood. Map prototype's `settlement_frequency`/`settlement_bank_name`/`settlement_account_number` to `sub_merchants.settlement_preference` + `settlement_destination` on the primary sub.
- Sub-merchants panel duplicates parent: matches backend inheritance by leaving new sub's `merchant_settings` row absent — `resolveEffectiveSettings()` at `settings.repository` will fall back to the merchant-level row. No special write needed to express "inherits".

### Step 4 — AI Compliance

| Prototype | Backend | Drift |
|---|---|---|
| "Run pipeline" client button produces mock `pipeline.ran` | Server runs `runCompliancePipeline(id)` on POST `/v1/merchants/:id/submit` (`merchants.routes.ts:77`) | **Prototype pipeline UI reads from backend, not the other way around.** Admin dashboard never calls submit — the merchant does (secret key). Option for admin-driven flow: add POST `/admin/merchants/:id/submit` that wraps `transitionMerchant` + `runCompliancePipeline` with admin auth. |
| Rule names invented in prototype (`doc_completeness`, `kra_match`, …) | Actual rule names flow through `compliance_rule_results` rows, visible via `GET /admin/merchants/:id` (`admin.routes.ts:262-266`) | Read `rule_results[]` from the detail endpoint and render verbatim. |
| AI confidence pill simulated | `compliance_reviews.confidence_score`, `explanation_summary`, `model_identifier` are real columns (`admin.routes.ts:272-283`) | Source from detail endpoint. |
| Status after pipeline: prototype sets `kyb_approved`/`kyb_in_progress` | Backend sets `under_ai_review`, then pipeline may advance to `under_manual_review` or set `changes_requested`/`rejected` | **Rename all status values end-to-end.** |

### Step 5 — Review

| Prototype | Backend | Drift |
|---|---|---|
| `review.decision ∈ {"approve","changes","reject"}` | zod enum: `{"approve","changes_requested","reject"}` | **Rename `"changes"` → `"changes_requested"`** everywhere in app.jsx (4 occurrences around `app.jsx:194, 1976-2111`). |
| Sends `{decision, note}` | POST `/v1/admin/compliance-reviews/:merchantId` expects `{decision, notes, actor_id?}` | **Rename `note` → `notes`**. `actor_id` can be empty; backend reads it as optional (`admin.routes.ts:36`). |
| Approve moves merchant to `kyb_approved` | Approve via `submitManualDecision` moves `under_manual_review → approved` (`compliance.service`) | Status string rename only. |
| Approve emits credentials + activation in prototype | Approve alone does **not** issue creds or activate — separate POST `/admin/merchants/:id/activate` does it all atomically (`admin.routes.ts:124-141`) | **Split the flow:** Approve → show "Ready to activate" → Activate CTA fires the activate endpoint. Prototype already has this two-step rhythm in Step 6; no change needed beyond status-name rename. |

### Step 6 — Activate (terminal)

| Prototype | Backend | Drift |
|---|---|---|
| Attestation checkbox gates Activate | No backend column | **Keep UI-only.** Do not POST the boolean. |
| Terminal status `active` | `active` | ✅ match |
| Shows generated `sk_test_...`, `pk_test_...`, `whsec_...` | `POST /admin/merchants/:id/activate` returns `{merchant, credentials, sub_merchants[]}` in one envelope (`admin.routes.ts:128-135`) | Render credentials from that response. Credentials struct comes from `issueCredentials(merchantId)` (`modules/auth/auth.service`). |

---

## 2. State machine rename table (authoritative)

Update `app.jsx:16-26` `MERCHANT_STATUSES`, plus every consumer, exactly as follows:

```
draft              → draft                    (unchanged)
kyb_in_progress    → submitted                (waiting for pipeline to pick up)
                   → under_ai_review          (pipeline running)
                   → under_manual_review      (manual decision needed)
kyb_approved       → approved                 (after approve decision)
credentials_issued → credentials_issued       (unchanged)
settings_configured → (remove — represented by editable Settings step + backend settings rows, not a status)
ready_for_activation → (remove — derived from status === "approved" || "credentials_issued")
active             → active                   (unchanged)
(new additions)    → changes_requested        (changes decision)
                   → rejected                 (reject decision)
                   → suspended                (post-active)
```

Backend transition map (`merchant.types.ts:25-36`):

```
draft              → submitted
submitted          → under_ai_review
under_ai_review    → under_manual_review | changes_requested | rejected
under_manual_review→ approved | changes_requested | rejected
changes_requested  → submitted
approved           → credentials_issued
credentials_issued → active
rejected           → draft
active             → suspended
suspended          → active
```

Also update:

- `app.jsx:48-60` `STEP_EDIT_MATRIX` — keyed by status; rename every key.
- `app.jsx:61-72` `STATUS_STYLE` — same.
- `app.jsx:313` — `["credentials_issued", "settings_configured", "ready_for_activation", "active"].includes(...)` guard: replace with `["approved", "credentials_issued", "active"].includes(...)`.
- `app.jsx:1061` "status: kyb-locked" copy string — replace with conditional based on real status.

---

## 3. API binding map — prototype action → `apps/admin/lib/api.ts` call

The api client already exists. Map each prototype action to the corresponding function. Items marked **NEW** need to be added.

| Prototype action | Backend endpoint | `api.ts` function | Notes |
|---|---|---|---|
| Create merchant (Step 2 save / prototype init) | POST `/admin/merchants` | `createMerchantAsAdmin(input)` ✅ | Already exists (`api.ts:284`). Map prototype `merchant` state → `CreateMerchantInput` (rename `kra_pin` → `tax_id`, convert KES to cents for volume/ticket). |
| Load full merchant | GET `/admin/merchants/:id` | `getMerchantDetail(id)` ✅ | Returns `{merchant, sub_merchants, documents, rule_results, reviews}` (`api.ts:293`). Hydrate all prototype state from this. |
| Upload compliance document | POST `/v1/merchants/:id/documents` (secret key) | `uploadDocument` **NEW admin variant needed** | Backend upload route is `authenticate()` + `requireSecretKey`. For admin-driven onboarding, add `/admin/merchants/:id/documents` mirror that uses `requireAdmin` + existing `uploadDocument` service. Until then, the merchant must upload via their own sk_. See §5. |
| Submit for review | POST `/v1/merchants/:id/submit` (secret key) | **NEW admin variant needed** | Same pattern as doc upload — add `/admin/merchants/:id/submit` or keep merchant-driven. Calls `transitionMerchant(id, Submitted)` then `runCompliancePipeline(id)`. |
| Patch settings (merchant-level) | PATCH `/v1/merchants/:id/settings` (secret key) | **NEW admin variant needed** | Add `/admin/merchants/:id/settings` that skips the ownership guard (which checks merchant_id against the principal). |
| Patch settings (sub-level override) | PATCH `/v1/sub-merchants/:id/settings` (secret key) | **NEW admin variant needed** | Same. |
| Create sub-merchant | POST `/v1/sub-merchants` (secret key) | **NEW admin variant needed** | Add `/admin/sub-merchants`. Body matches existing `createSubMerchantBody` (`merchants.routes.ts:89-102`). |
| Submit compliance decision | POST `/admin/compliance-reviews/:id` | `submitComplianceDecision(merchantId, decision, notes)` ✅ | Already exists (`api.ts:297`). Signature matches. Just rename client-side `changes` → `changes_requested`. |
| Activate merchant | POST `/admin/merchants/:id/activate` | `activateMerchant(merchantId)` ✅ | Already exists (`api.ts:308`). Returns credentials in response — surface `sk_*, pk_*, whsec_*` from the activate response. |
| Suspend merchant | POST `/admin/merchants/:id/suspend` | **NEW** | Exists in backend (`admin.routes.ts:145-154`) but not in `api.ts`. Trivial to add. |
| List merchants for queue | GET `/admin/merchants?status=...&search=...` | `listMerchants(params)` ✅ | Already exists (`api.ts:249`). |

**All payload shapes to use** (copy directly from `admin.routes.ts` zod schemas):

- Create: `adminCreateMerchantBody` (`admin.routes.ts:48-75`).
- Decision: `reviewBody` (`admin.routes.ts:33-37`).
- Settings: `settingsBody` (`merchants.routes.ts:212-222`).
- Create sub: `createSubMerchantBody` (`merchants.routes.ts:89-102`).
- Doc upload: multipart/form-data with fields `file` (binary) + `type` (string from `SUPPORTED_DOCUMENT_TYPES`) + optional `sub_merchant_id`.

---

## 4. Field-by-field rename sheet (app.jsx diff plan)

Run these substitutions in `app.jsx`. Every one is covered by jsdom tests in `verify.js`.

| Replace | With | Rationale |
|---|---|---|
| `kyb_in_progress` | `submitted` (or `under_ai_review`/`under_manual_review` depending on sub-state) | Backend status name |
| `kyb_approved` | `approved` | Backend status name |
| `settings_configured` | (remove — derive from `status === "approved"` + settings rows present) | Not a status in backend |
| `ready_for_activation` | (remove — derive from `status === "approved" \|\| "credentials_issued"`) | Not a status in backend |
| `kyb-locked` | `locked` (and compute from `!["draft","changes_requested"].includes(status)`) | Copy only |
| `certificate_of_incorporation` | `certificate_of_registration` | Document type enum |
| `cr12` | (remove; use `director_id` with per-director upload already present) | Document type enum |
| `kra_pin` (as doc key) | `tax_certificate` | Document type enum |
| `business_address_proof` | `proof_of_address` | Document type enum |
| `merchant.kra_pin` (as field) | `merchant.tax_id` | Merchant column name |
| `review.decision === "changes"` | `review.decision === "changes_requested"` | zod enum |
| `review.note` | `review.notes` | zod field |
| `sub.display_name` | `sub.name` | sub_merchants column |
| `sub.status === "sub-draft"` | `sub.status === "draft"` | sub_merchants enum |
| `settings.settlement_frequency` | `primary_sub.settlement_preference` | Lives on sub_merchants, not settings |
| `settings.settlement_bank_name` + `settings.settlement_account_number` | `primary_sub.settlement_destination.{bank_name, account_number}` | jsonb on sub_merchants |
| `settings.settlement_fee_kes` (floor 100 KES) | `settings.settlement_fee_pct` (percentage, float) | Backend is pct, not flat KES — product decision needed; flag to PK |

---

## 5. The one real architectural decision: admin-driven vs merchant-driven uploads

This is the only blocker that isn't a rename.

**Today's backend split:**
- Public/merchant routes (`/v1/...`, `authenticate() + requireSecretKey`): upload docs, submit for review, PATCH settings, create sub-merchants. All require a live `sk_*` key.
- Admin routes (`/v1/admin/...`, `requireAdmin`): create merchant, read everything, make review decisions, activate/suspend.

**Prototype assumes admin drives the whole flow from the dashboard.** That's not how the backend is factored today — there's no admin-authenticated doc upload or settings endpoint. Two ways to resolve:

### Option A — Add admin mirrors (recommended, ~30 lines of backend)

Add six admin endpoints that wrap the same services with `requireAdmin` instead of `requireSecretKey`:

```
POST   /v1/admin/merchants/:id/documents         → wraps uploadDocument()
POST   /v1/admin/merchants/:id/submit            → transitionMerchant + runCompliancePipeline
PATCH  /v1/admin/merchants/:id/settings          → upsertSettings (merchant-level, sub_id=null)
PATCH  /v1/admin/sub-merchants/:id/settings      → upsertSettings (sub override)
POST   /v1/admin/sub-merchants                   → createSubMerchant
PATCH  /v1/admin/merchants/:id                   → updateMerchantProfile
```

Prototype UI slots in as-is; api.ts grows six new functions. This is what PK's mocks imply and what Claude Code should do.

### Option B — Split UI into admin + merchant apps

Keep backend as-is. Prototype becomes two apps:
- `apps/admin/app/merchants/[id]/*` for create + review + activate (admin secret).
- `apps/merchant/app/onboarding/*` (new) for document upload + profile + settings + submit (merchant `sk_`).

More code, more surface area, but matches the backend's current opinion about who-can-do-what.

**Recommendation for plug-and-play merge:** Option A. Six thin route handlers, zero service changes, one api.ts grow, UI ships as a single app under `apps/admin/app/merchants/onboarding/`.

---

## 6. Money handling

Backend stores amounts in **minor units** (cents) as `bigint`. Example from `apps/admin/app/compliance/new/page.tsx:11-17`:

```ts
function kesToCents(v: FormDataEntryValue | null): number | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const kes = Number(s);
  if (!Number.isFinite(kes) || kes < 0) return undefined;
  return Math.round(kes * 100);
}
```

Prototype stores `expected_monthly_volume_kes: 150000` (whole KES). **Convert to cents on POST**, convert back on GET. Always multiply/divide by 100 at the api.ts boundary, never in component code. Settlement fee already a percentage float — no conversion.

---

## 7. Keep-as-UI-only list

These prototype affordances have no backend analogue and should remain client-side:

- **Journey-bar step navigation** (click any step to jump) — pure UI.
- **Reveal timer on generated credentials** — UX only; credentials come from activate response.
- **Director list auto-assembly from CR12 extraction** — replace CR12 with per-director `director_id` docs; directors become whatever `extracted_data` returns for each `director_id` row.
- **Attestation checkbox** — keep as activate gate; do not POST.
- **Demo-mode panel** — flag/strip for prod build (CoS prototype artifact, not a product feature).
- **"Inherits parent settings" badge on sub-merchants** — derived from `merchant_settings` row absence; display logic only.
- **Fee floor of ~80 KES settlement cost** — internal cost anchor, not persisted.

---

## 8. Validation checklist before opening the merge PR

Run through this before Claude Code opens the PR:

- [ ] `grep -rn "kyb_in_progress\|kyb_approved\|settings_configured\|ready_for_activation" apps/admin/` returns 0 hits.
- [ ] `grep -rn "certificate_of_incorporation\|cr12\|kra_pin[^_a-z]" apps/admin/` returns 0 hits (tax_id is fine).
- [ ] `grep -rn '"changes"' apps/admin/` returns 0 hits (only `"changes_requested"`).
- [ ] Prototype POSTs `decision` and `notes` (not `note`).
- [ ] All KES inputs → cents at api.ts boundary.
- [ ] Activate response `credentials` (not a follow-up call) feeds the Step 6 reveal.
- [ ] Six new admin endpoints added (see §5 Option A) OR the UI is split.
- [ ] `npm run typecheck && npm run test` green in `apps/admin` and `src/`.

---

## 9. Reference index

Backend authoritative sources cited above:

- `OGUN/src/modules/merchant/merchant.types.ts` — status enum, transitions, row shapes.
- `OGUN/src/modules/document/document.service.ts` — `SUPPORTED_DOCUMENT_TYPES`, upload guards.
- `OGUN/src/api/routes/admin.routes.ts` — admin endpoints + zod schemas.
- `OGUN/src/api/routes/merchants.routes.ts` — merchant + sub-merchant + settings zod schemas.
- `OGUN/src/api/routes/documents.routes.ts` — multipart upload handler.
- `OGUN/apps/admin/lib/api.ts` — existing client; extend here.
- `OGUN/apps/admin/app/compliance/new/page.tsx` — `kesToCents` pattern to reuse.
- `OGUN/src/infra/db/migrations/0001_initial_schema.sql` — table columns.
- `OGUN/src/infra/db/migrations/0002_*.sql` — partial unique indexes for settings inheritance.

— Optimus Prime
