# Prompt for Claude Code — Ogun Merchant Onboarding Wizard

> **How to use this:** open Claude Code from the **`OGUN/`** repo root. Paste everything between the `---` lines below as your first message.

---

You are working on the **Ogun payment infrastructure** monorepo. We have a finalised
HTML prototype of the admin merchant onboarding flow that needs to be translated into
the real Next.js admin app and wired to the existing Express backend.

## Your task, in one sentence
Implement the admin merchant onboarding wizard, the post-activation merchant panel, and the three admin aggregated dashboards (Collections / Payouts / Settlements) shown in the prototype, against the actual backend at HEAD `1124162b1f0ea0c48bd649cb34085476d158b0f5`.

## Read these four files before writing a single line of code

In this exact order — all paths are repo-relative:

1. **`docs/onboarding-prototype/03-validation-report.md`** — what was confirmed against the repo at HEAD `1124162b...`. This is your **factual source of truth** for routes, state machines, auth, and known drift. Trust this over the prototype if they conflict.
2. **`docs/onboarding-prototype/04-drift-analysis.md`** — per-step UI vs. backend drift. Names every mismatch between the prototype's state names and the backend's.
3. **`docs/onboarding-prototype/05-merge-checklist.md`** — the 8-phase plug-and-play checklist with target file paths under `apps/admin/app/merchants/onboarding/`.
4. **`docs/onboarding-prototype/02-prototype-source.jsx`** — the finalised React source of the prototype. Use as the **visual + behavioural reference**. Do not copy-paste verbatim; translate into proper Next.js server-component patterns.

The compiled prototype is `docs/onboarding-prototype/01-prototype.html` if you want to open it in a browser to feel the flow.

## Verify the repo state before starting

```bash
git rev-parse HEAD                    # must equal 1124162b1f0ea0c48bd649cb34085476d158b0f5
git rev-parse --abbrev-ref HEAD       # must equal claude/payment-infrastructure-kenya-jzQmF
git status                            # docs/onboarding-prototype/ should show as untracked or already-committed
```

If HEAD has moved, **stop and ask** before continuing — the validation report was written for that exact commit.

## Branch strategy

Create a new feature branch off the current HEAD:
```bash
git checkout -b feature/admin-merchant-onboarding-wizard
```

There is **no `main` branch** on the remote — only `claude/payment-infrastructure-kenya-jzQmF`. Confirm with the user before opening a PR; the merge target may be the existing claude branch or a new `main` may need to be created first.

## Scope (in order)

### Phase 1 — Backend gap closure (smallest possible)
Add only the admin-side routes the wizard needs that don't exist yet. From `03-validation-report.md` §5 and §8:

1. `POST /v1/admin/sub-merchants` — admin-authenticated mirror of `POST /v1/sub-merchants`. Requires `requireAdmin`, accepts `merchant_id` + same body.
2. `PATCH /v1/admin/merchants/:id/settings` — admin mirror of `PATCH /v1/merchants/:id/settings`.
3. `PATCH /v1/admin/sub-merchants/:id/settings` — admin mirror.
4. `GET /v1/admin/settlements` — paginated cross-merchant settlements list (mirror the shape of `GET /v1/admin/payouts`).
5. (Optional, only if a single-list pull would be too large) `GET /v1/admin/collections/summary` and `GET /v1/admin/payouts/summary` returning aggregated KPIs (TPV, success-rate weighted by TPV, count). If skipped, compute aggregations client-side from the existing list endpoints.

**Mirror the existing pattern** from `src/api/routes/admin.routes.ts`: `requireAdmin(req)`, `parseBody`/`parseQuery`, `success()` / `paginated()` envelopes, normalize bigint money to numbers in the response. Do **not** invent a different auth or response shape.

### Phase 2 — API client extensions
In `apps/admin/lib/api.ts` add typed wrappers:
- `issueCredentials(merchantId)` → POST `/admin/merchants/:id/credentials`
- `suspendMerchant(merchantId, reason)`
- `createSubMerchantAsAdmin(input)`
- `updateMerchantSettingsAsAdmin(id, body)`
- `updateSubMerchantSettingsAsAdmin(id, body)`
- `listSettlements(...)` (and any summary endpoints you added)
- `uploadDocument(merchantId, file, type)` — verify whether `documents.routes.ts` has an admin path; add if missing.

Keep the same `request<T>()` / `paged<T>()` helpers — don't introduce a new fetch layer.

### Phase 3 — Onboarding wizard
Per the merge checklist, target directory: `apps/admin/app/merchants/onboarding/`.

Use **Server Components + Server Actions**, not client-side state machines, except where the UX genuinely needs interactivity (file upload, multi-step form drafting). Persist wizard progress to the merchant row (`status` + the existing nullable profile fields) via the API — do not invent a new draft-state table.

**Rename every prototype-only state to its backend equivalent** (drift table in §3 of validation report):
- `kyb_in_progress` → `under_manual_review`
- `kyb_approved` → `approved`
- `settings_configured` → `credentials_issued`
- `ready_for_activation` → `credentials_issued`

### Phase 4 — Post-activation merchant panel
Reachable by clicking a row in the merchant list when `status === 'active'`. Tabs: Settings (Profile / Accounts / Sub-merchants / Credentials) | Collections | Payouts | Settlements. Mostly read views; mutations call the API client functions.

### Phase 5 — Admin aggregated dashboards
`/admin/collections`, `/admin/payouts`, `/admin/settlements` — cross-merchant rollups with TPV-weighted (collections, settlements) / volume-weighted (payouts) success rate, KPI cards, sparklines, and a filterable per-merchant table. Drill-into-merchant from the table opens the panel from Phase 4.

### Phase 6 — Tests
- Unit tests for the new backend routes (mirror the existing `merchant.types.test.ts` style).
- A smoke test that walks the wizard end-to-end against a test database.
- Type-check: `cd apps/admin && pnpm typecheck` (or `npm run typecheck`) must pass.

## Conventions to follow (non-negotiable)

- **Money in minor units (cents) as bigint at the DB layer; numbers at the API layer.** Use the `kesToCents()` helper pattern from `apps/admin/app/compliance/new/page.tsx`.
- **Server-only secret.** Admin secret comes from `OGUN_ADMIN_SECRET` env (with cookie fallback). **Never** prefix with `NEXT_PUBLIC_`.
- **`<Page>` + `<Badge>` + `await requireAuth()`** at the top of every new admin page.
- **Tailwind only**, with the existing semantic classes (`panel-padded`, `text-ogun-muted`, `text-ogun-accent`, `badge-{status}`, `mono`, `kv`).
- **JSON envelope:** `{ status, data, meta }` for success; `{ status: 'error', error: { code, message, details? } }` for errors. Use the existing `success()` / `paginated()` helpers.
- **No new auth model.** Mirror `requireAdmin(req)`.
- **No mocking of the database in tests** — use the existing test harness pattern.

## What success looks like

1. `git diff` shows changes scoped to the files listed in the merge checklist + the gap-closure routes.
2. `pnpm typecheck` (or `npm run typecheck`) passes in `apps/admin/`.
3. The Next.js admin app at `localhost:4001` lets the user click "+ New merchant", walk the wizard end to end against a local backend at `localhost:4000`, see the merchant become `active`, land on the merchant panel, and switch between Settings / Collections / Payouts / Settlements.
4. `/admin/collections`, `/admin/payouts`, `/admin/settlements` show aggregated KPIs across all merchants.
5. A short PR description that names every backend route added and every Next.js page added.

## What to ask before writing code

If anything in the validation report contradicts the prototype, ask. If a backend gap is bigger than expected, ask. **Don't silently add tables, columns, or auth flows** — flag them and let the user decide.

---

## End of prompt
