# Ogun prototype → production merge — plug-and-play checklist for Claude Code

**Input artifact:** `ogun-onboarding-prototype.html` (v1.2.2, single-file React+Tailwind)
**Target repo:** `OGUN/` (apps/admin + src/)
**Reference review:** `ogun-ui-vs-backend-ultrareview.md` (sibling file)
**Owner:** PK
**Assumption:** Option A from §5 of the ultrareview — six admin mirror endpoints are added, prototype slots in as a single admin-driven app.

Work top-to-bottom. Every step ends with a grep/test gate.

---

## Phase 1 — Backend: add admin mirrors (30-40 lines)

Goal: give the admin dashboard authenticated access to upload docs, patch settings, create subs, and submit for review without needing a merchant secret key.

### 1.1 Add six admin routes in `src/api/routes/admin.routes.ts`

Append after line 588 (the `/admin/session` route). Each handler calls the **same service function** used by the merchant-facing route — just swap `requireSecretKey(req)` for the existing `requireAdmin(req)`. No service changes.

```
POST   /admin/merchants/:merchantId/documents     → uploadDocument()      (multer .single('file'))
POST   /admin/merchants/:merchantId/submit        → transitionMerchant + runCompliancePipeline
PATCH  /admin/merchants/:id                        → updateMerchantProfile  (patchMerchantBody schema)
PATCH  /admin/merchants/:id/settings              → upsertSettings         (settingsBody schema, sub_merchant_id=null)
POST   /admin/sub-merchants                        → createSubMerchant      (createSubMerchantBody schema)
PATCH  /admin/sub-merchants/:id/settings          → upsertSettings         (settingsBody, sub_merchant_id=sub.id)
```

Copy the zod schemas verbatim from `merchants.routes.ts` (`patchMerchantBody:143-158`, `settingsBody:212-222`, `createSubMerchantBody:89-102`). Each handler is ≤ 10 lines. Pattern example:

```ts
router.patch('/admin/merchants/:id/settings', async (req, res, next) => {
  try {
    requireAdmin(req);
    const body = parseBody(settingsBody, req.body);
    await upsertSettings({
      id: newId('merchantSettings'),
      merchant_id: req.params.id,
      sub_merchant_id: null,
      ...body,
    });
    const effective = await resolveEffectiveSettings(req.params.id, null);
    res.json(success(effective, { request_id: req.ogunContext.requestId }));
  } catch (err) { next(err); }
});
```

### 1.2 Gate

- `npm run test -- admin.routes` passes.
- Add integration tests in `src/api/admin.routes.integration.test.ts` exercising each new endpoint with `X-Ogun-Admin-Secret`.

---

## Phase 2 — API client: extend `apps/admin/lib/api.ts`

### 2.1 Add typed helpers for the six new endpoints + `suspendMerchant` (already backend-exposed but missing from client)

Follow the same `request<T>()` / `paged<T>()` pattern already in the file. Signatures:

```ts
export async function uploadMerchantDocument(
  merchantId: string,
  form: FormData,               // must contain "file" + "type" (+ optional "sub_merchant_id")
): Promise<DocumentDetail>;

export async function submitMerchantForReview(
  merchantId: string,
): Promise<{ merchant_id: string; status: string; recommendation: string; flags: unknown }>;

export async function updateMerchantProfile(
  merchantId: string,
  body: Partial<CreateMerchantInput>,
): Promise<MerchantSummary>;

export async function patchMerchantSettings(
  merchantId: string,
  body: SettingsBody,
): Promise<EffectiveSettings>;

export async function patchSubMerchantSettings(
  subMerchantId: string,
  body: SettingsBody,
): Promise<EffectiveSettings>;

export async function createSubMerchantAsAdmin(
  body: CreateSubMerchantInput,
): Promise<{ id: string; merchant_id: string; status: string }>;

export async function suspendMerchant(
  merchantId: string,
  reason: string,
): Promise<{ id: string; status: string }>;
```

### 2.2 Money at the boundary

Reuse the `kesToCents` pattern from `apps/admin/app/compliance/new/page.tsx:11-17`. Add a companion `centsToKes` for read paths. **Every amount crossing the api.ts boundary goes through one of these two — component code only ever sees KES.**

### 2.3 Gate

- `npm run typecheck -- --project apps/admin/tsconfig.json` passes.
- Unit tests on the two helpers (round-trip exactness for 0, 1, 150000, 9999999).

---

## Phase 3 — Split the single-file prototype into Next.js App Router routes

### 3.1 Target directory layout under `apps/admin/app/merchants/onboarding/`

```
onboarding/
├── [id]/
│   ├── layout.tsx              — JourneyBar + StatusChip + MerchantHeader
│   ├── page.tsx                — redirects to current step (server derived from status)
│   ├── people-documents/
│   │   ├── page.tsx            — server component: read detail, render client form
│   │   └── actions.ts          — "use server" document upload + director upload
│   ├── profile/
│   │   ├── page.tsx
│   │   └── actions.ts          — updateMerchantProfile
│   ├── settings/
│   │   ├── page.tsx            — server component with SubMerchantsPanel (client)
│   │   ├── actions.ts          — patchMerchantSettings, createSubMerchantAsAdmin, patchSubMerchantSettings
│   │   └── SubMerchantsPanel.client.tsx
│   ├── compliance/
│   │   ├── page.tsx            — shows rule_results[], reviews[] from detail
│   │   └── actions.ts          — submitMerchantForReview
│   ├── review/
│   │   ├── page.tsx
│   │   └── actions.ts          — submitComplianceDecision
│   └── activate/
│       ├── page.tsx            — renders credentials from activate response
│       └── actions.ts          — activateMerchant
└── new/
    └── (already exists at apps/admin/app/compliance/new — move or link)
```

### 3.2 Mapping rules for the single-file React → Next split

| Prototype construct (app.jsx) | Becomes |
|---|---|
| `App` component + `renderStep` | `app/merchants/onboarding/[id]/layout.tsx` (journey bar) + route segments (one per step) |
| `useState` for `merchant`, `documents`, `settings`, `subMerchants`, `directors`, `review`, `pipeline` | **Server state** read from `getMerchantDetail(id)` in each route's `page.tsx`. No client state mirror. |
| `useEffect` auto-fill from extracted docs | Derived server-side from `MerchantDetail.documents[n].extracted_data` |
| `onNext` / `onBack` journey stepping | `<Link>` to the next route; `redirect()` from server actions on success |
| `addFromParent()` in Step 3 | Server action `createSubMerchantAsAdmin({ merchant_id, name, code, settlement_preference, settlement_destination })` — backend's row absence in `merchant_settings` auto-inherits |
| Demo-mode panel | **Remove** from production build (keep local HTML for internal demos) |
| `DEMO_VIEW` / `view === "merchant"` vs `"admin"` | Remove — production admin app is always admin view |
| Journey click-to-jump | Keep — the journey bar is a client component with `<Link>`s gated by `STEP_EDIT_MATRIX[status]` |

### 3.3 Apply all renames from ultrareview §4 during the split

Do the substitutions **while** splitting the file — don't port `kyb_in_progress` into Next and then rename. Reference ultrareview §4 for the full sheet.

### 3.4 Gate

- `npm run build` in `apps/admin` green.
- `npm run lint` green.
- Every server action returns `redirect('/merchants/onboarding/[id]/[next-step]')` on success.

---

## Phase 4 — Apply state-name renames (cross-cutting)

From ultrareview §2. Do a single sweep:

```bash
# Run from repo root
grep -rn 'kyb_in_progress\|kyb_approved\|settings_configured\|ready_for_activation\|kyb-locked' apps/admin/ src/ | grep -v node_modules
# (expect 0 hits after Phase 3)

grep -rn 'certificate_of_incorporation\|\bcr12\b\|business_address_proof' apps/admin/ src/ | grep -v node_modules
# (expect 0 hits; kra_pin as a column name is also gone — tax_id only)

grep -rn '"changes"[^_]' apps/admin/
# (expect 0 hits; only "changes_requested")
```

Also update any `apps/admin/components/*` that render status badges to know the full 10 states (draft, submitted, under_ai_review, under_manual_review, changes_requested, approved, rejected, credentials_issued, active, suspended).

---

## Phase 5 — Attestation & UI-only elements

Per ultrareview §7:

- Attestation checkbox stays client-side; value is held in a `useState` inside the activate route's client component; it gates the Activate button only.
- Demo panel stripped from prod build (CoS artifact).
- Reveal timer on credentials kept as UX affordance.
- Director directory built from `documents.filter(d => d.type === 'director_id').map(d => d.extracted_data)`.
- "Inherits parent settings" badge rendered when the sub has no `merchant_settings` row returned by the backend — the backend already handles this via `resolveEffectiveSettings()` returning a `source: 'merchant' | 'sub_merchant'` field; expose it and render the badge accordingly.

---

## Phase 6 — Migrate the jsdom verify suite to integration tests

The existing `/tmp/ogun-build/verify.js` jsdom harness (21 assertions) stops being useful once we split into Next. Replace with:

### 6.1 Playwright end-to-end tests

Add `apps/admin/e2e/onboarding.spec.ts` that:

1. Logs in with admin secret.
2. Creates a merchant via `/compliance/new` form.
3. Follows the journey: uploads each required doc, fills profile, configures settings, adds a sub-merchant, submits for review.
4. Switches to admin view, approves, activates.
5. Asserts terminal state shows `active` status + credentials.

### 6.2 Integration tests for the six new admin routes

Add to `src/api/admin.routes.integration.test.ts`. Copy shape of existing `api.integration.test.ts`.

### 6.3 Gate

- All new tests green.
- Delete `/tmp/ogun-build/` once migration is confirmed (no longer authoritative).

---

## Phase 7 — Env & config

- Already wired: `OGUN_API_BASE_URL`, `OGUN_ADMIN_SECRET`, `ogun_admin_secret` cookie (`apps/admin/lib/api.ts:14-22`).
- No new env variables required by the onboarding split.
- If Option A adds `/admin/merchants/:id/documents`, ensure `multer` is already in `src/package.json` (it is — used by `documents.routes.ts:9`).

---

## Phase 8 — Final merge gate

Before opening the PR:

- [ ] Phases 1-6 all green.
- [ ] `grep` checks in Phase 4 all return 0.
- [ ] `apps/admin/app/merchants/onboarding/**` builds and typechecks.
- [ ] `npm run test` green in both `OGUN/` and `OGUN/apps/admin/`.
- [ ] Playwright e2e run green at least once locally.
- [ ] `openapi.yaml` updated to describe the six new admin endpoints.
- [ ] `OGUN/README.md` updated with a one-line pointer to `/merchants/onboarding`.
- [ ] Screenshot (or screen recording) of each step attached to the PR description.

---

## Appendix — merchant payload examples (authoritative)

All copied from the backend zod schemas. Paste these into server-action JSDoc.

### Create merchant (POST `/admin/merchants`)

```json
{
  "legal_name": "Tamasha Solutions Limited",
  "trading_name": "Tamasha",
  "registration_number": "PVT-K-2024-12345",
  "tax_id": "P051234567X",
  "country": "KE",
  "settlement_currency": "KES",
  "business_category": "hospitality",
  "business_address": { "street": "...", "city": "...", "county": "...", "postal_code": "..." },
  "website_url": "https://tamasha.example",
  "expected_monthly_volume": 15000000,
  "expected_avg_ticket": 5000,
  "contact": { "name": "...", "email": "...", "phone": "..." },
  "notification_emails": ["ops@tamasha.example"]
}
```

### Review decision (POST `/admin/compliance-reviews/:id`)

```json
{
  "decision": "approve" | "changes_requested" | "reject",
  "notes": "string (max 2000)",
  "actor_id": "optional"
}
```

### Settings (PATCH `/admin/merchants/:id/settings` or `/admin/sub-merchants/:id/settings`)

```json
{
  "collection_fee_pct": 1.5,
  "collection_fee_model": "merchant_covers" | "payer_covers",
  "payout_fee_pct": 1.0,
  "payout_fee_model": "merchant_covers" | "recipient_covers",
  "settlement_fee_pct": 0,
  "notification_emails": ["..."],
  "enabled_methods": ["mpesa", "airtel", "till", "card", "bank"]
}
```

### Create sub-merchant (POST `/admin/sub-merchants`)

```json
{
  "merchant_id": "mrc_...",
  "name": "Tamasha Online Store",
  "code": "TAM-001",
  "settlement_preference": "daily" | "weekly" | "monthly" | "on_demand",
  "settlement_destination": { "bank_name": "Equity Bank Kenya", "account_number": "..." },
  "contact": { "name": "...", "email": "...", "phone": "..." }
}
```

### Document upload (POST `/admin/merchants/:id/documents`)

Multipart form-data:
- `file`: binary (≤ 15 MB)
- `type`: one of `certificate_of_registration`, `tax_certificate`, `director_id`, `proof_of_address`, `bank_confirmation`, `business_permit`, `authority_letter`, `other`
- `sub_merchant_id`: optional

### Activate (POST `/admin/merchants/:id/activate`)

Empty body. Response:

```json
{
  "merchant": { "id": "mrc_...", "status": "active" },
  "credentials": { "secret_key": "sk_...", "publishable_key": "pk_...", "webhook_secret": "whsec_..." },
  "sub_merchants": [{ "id": "smrc_...", "status": "active" }]
}
```

— Optimus Prime
