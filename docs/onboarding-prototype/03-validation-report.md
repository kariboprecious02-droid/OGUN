# Ogun Repo Validation Report

> Validates every reference in the prototype handoff against the actual GitHub repo,
> so Claude Code is given **factual** instructions, not snapshots of a different commit.

**Generated:** 2026-04-25
**Validated against repo HEAD:**

| Item    | Value |
|---------|-------|
| Remote  | https://github.com/kariboprecious02-droid/OGUN.git |
| Branch  | `claude/payment-infrastructure-kenya-jzQmF` |
| Commit  | `1124162b1f0ea0c48bd649cb34085476d158b0f5` |
| Subject | "Expand merchant creation form to cover full PRD schema" |
| `main` branch | **does not exist on remote** — only the feature branch above |
| CI/CD   | none configured (`.github/workflows/` is absent) |

If your local clone is on a different commit, re-run validation before starting.

---

## 1. Backend admin routes — confirmed present

File: `src/api/routes/admin.routes.ts`

| Method  | Path                                         | Purpose                                               | Line |
|---------|----------------------------------------------|-------------------------------------------------------|------|
| POST    | `/v1/admin/merchants`                        | Admin-initiated merchant create (no merchant secret)  | 77   |
| POST    | `/v1/admin/compliance-reviews/:merchantId`   | Approve / changes_requested / reject                  | 93   |
| POST    | `/v1/admin/merchants/:merchantId/credentials`| Issue credentials (post-approval)                     | 114  |
| POST    | `/v1/admin/merchants/:merchantId/activate`   | Activate + auto-issue credentials + return sub-merchants | 124 |
| POST    | `/v1/admin/merchants/:merchantId/suspend`    | Suspend with reason                                   | 145  |
| GET     | `/v1/admin/merchants`                        | Paginated list, filter `status` + `search`            | 180  |
| GET     | `/v1/admin/merchants/:id`                    | Full detail: merchant + sub_merchants + documents + rule_results + reviews | 234 |
| GET     | `/v1/admin/wallets`                          | Cross-merchant wallet inspector, filter `merchant_id` / `sub_merchant_id` / `wallet_type` | 327 |
| GET     | `/v1/admin/wallets/:id/ledger`               | Ledger entries for a wallet                           | 396  |
| GET     | `/v1/admin/collections`                      | Cross-merchant collections, filter `merchant_id` / `sub_merchant_id` / `business_status` | 444 |
| GET     | `/v1/admin/payouts`                          | Cross-merchant payouts, filter `merchant_id` / `sub_merchant_id` / `status` | 516 |
| POST    | `/v1/admin/session`                          | Verify admin secret (login)                           | 576  |

**Auth model:** `X-Ogun-Admin-Secret` header. Server-side env (`OGUN_ADMIN_SECRET`); falls back to `webhookSigningSalt` for legacy. Cookie-based session (`ogun_admin_secret` cookie) on the dashboard side. *(`apps/admin/lib/api.ts` line 14-22, `apps/admin/lib/session.ts` line 1-13.)*

---

## 2. Backend merchant routes — confirmed present

File: `src/api/routes/merchants.routes.ts`

| Method  | Path                                       | Notes                                                  |
|---------|--------------------------------------------|--------------------------------------------------------|
| POST    | `/v1/merchants`                            | Public; **requires merchant secret** — chicken-and-egg |
| GET     | `/v1/merchants/:id`                        | Public; merchant principal                             |
| POST    | `/v1/merchants/:id/submit`                 | Triggers compliance pipeline                           |
| PATCH   | `/v1/merchants/:id`                        | Whitelisted profile fields                             |
| POST    | `/v1/sub-merchants`                        | Create sub-merchant                                    |
| GET     | `/v1/sub-merchants` / `/sub-merchants/:id` | List / get                                             |
| PATCH   | `/v1/sub-merchants/:id`                    | Whitelisted sub-merchant fields                        |
| PATCH   | `/v1/merchants/:id/settings`               | Merchant-level settings                                |
| GET     | `/v1/merchants/:id/settings`               | Effective settings                                     |
| PATCH   | `/v1/sub-merchants/:id/settings`           | Sub-merchant settings override                         |
| POST    | `/v1/merchants/:id/api-keys/rotate`        | Secret-key rotation                                    |
| POST    | `/v1/merchants/:id/webhook-secret/rotate`  | Webhook secret rotation                                |

**Settings body schema** (`merchants.routes.ts` line 212-222):
```ts
collection_fee_pct, collection_fee_model: 'merchant_covers' | 'payer_covers',
payout_fee_pct, payout_fee_model: 'merchant_covers' | 'recipient_covers',
settlement_fee_pct, notification_emails: string[], enabled_methods: string[]
```

**Sub-merchant settlement_preference enum** (line 93, 178):
`'daily' | 'weekly' | 'monthly' | 'on_demand'`

---

## 3. Merchant state machine — authoritative

File: `src/modules/merchant/merchant.types.ts`

```
draft → submitted → under_ai_review → under_manual_review → approved → credentials_issued → active
                           ↓                    ↓
                    changes_requested       changes_requested
                    rejected                rejected
                                            (manual approve only)
active ↔ suspended
changes_requested → submitted (resubmit)
rejected → draft
```

Backend enum (line 9-20): `draft, submitted, under_ai_review, under_manual_review, changes_requested, approved, rejected, credentials_issued, active, suspended`.

**Prototype drift (must rename in Next.js translation):**

| Prototype state           | Backend state         |
|---------------------------|-----------------------|
| `kyb_in_progress`         | `under_manual_review` |
| `kyb_approved`            | `approved`            |
| `settings_configured`     | `credentials_issued`* |
| `ready_for_activation`    | `credentials_issued`* |

\* The backend collapses these prototype steps. Settings are configured via `PATCH /v1/merchants/:id/settings` *after* `credentials_issued`; activation is a separate POST and does not require a "ready" intermediate state.

---

## 4. Admin Next.js app — confirmed structure

```
apps/admin/
├── app/
│   ├── layout.tsx                    # Minimal: just <body>{children}</body>
│   ├── page.tsx                      # Home: stat cards + recent collections/payouts
│   ├── login/page.tsx                # Admin secret login (currently bypassable)
│   ├── compliance/
│   │   ├── page.tsx                  # Merchant list
│   │   ├── new/page.tsx              # Admin-create merchant form
│   │   └── [id]/page.tsx             # Merchant detail + review actions
│   ├── collections/page.tsx          # Cross-merchant collections list
│   ├── payouts/page.tsx              # Cross-merchant payouts list
│   ├── wallets/[id]/page.tsx         # Wallet ledger
│   └── version/page.tsx              # Version info
├── components/
│   ├── Nav.tsx                       # Top nav: Compliance | Wallets | Collections | Payouts
│   ├── Page.tsx                      # <Page title subtitle actions>{children}</Page>
│   └── Badge.tsx                     # <Badge status> + formatIsoDate
├── lib/
│   ├── api.ts                        # Server-only API client
│   └── session.ts                    # requireAuth (currently no-op), loginWithSecret, logout
└── package.json                      # Next 14.2.13, React 18.3, Tailwind 3.4
```

**Style conventions** (from existing pages):
- Server components by default; client components only where needed
- Server Actions via `'use server'` for mutations
- Tailwind with semantic classes: `panel-padded`, `text-ogun-muted`, `text-ogun-accent`, `badge badge-{status}`, `mono`, `kv` (defined in `globals.css`)
- Always wrap pages in `<Page title subtitle actions>` + `await requireAuth()` (no-op today but contract for future)

---

## 5. Existing API client functions — what Claude Code can call directly

File: `apps/admin/lib/api.ts`

| Function                                       | Maps to                                              |
|------------------------------------------------|------------------------------------------------------|
| `verifyAdminSession(secret)`                   | POST `/admin/session`                                |
| `listMerchants({status, search, page, limit})` | GET `/admin/merchants`                               |
| `createMerchantAsAdmin(input)`                 | POST `/admin/merchants` — already PRD-complete       |
| `getMerchantDetail(id)`                        | GET `/admin/merchants/:id`                           |
| `submitComplianceDecision(id, decision, notes)`| POST `/admin/compliance-reviews/:id`                 |
| `activateMerchant(id)`                         | POST `/admin/merchants/:id/activate`                 |
| `listWallets(...)` / `getWalletLedger(id, ...)`| GET `/admin/wallets` / `:id/ledger`                  |
| `listCollections(...)` / `listPayouts(...)`    | GET `/admin/collections` / `/payouts`                |

**Functions NOT yet in api.ts (Claude Code must add):**

| Needed function                                | Maps to                                                |
|------------------------------------------------|--------------------------------------------------------|
| `issueCredentials(merchantId)`                 | POST `/admin/merchants/:id/credentials`                |
| `suspendMerchant(merchantId, reason)`          | POST `/admin/merchants/:id/suspend`                    |
| `createSubMerchant(input)` (admin path)        | **Backend gap** — no admin-side route exists yet; only `/sub-merchants` on the merchant principal exists. Either (a) add `/admin/sub-merchants` or (b) wait for credentials issue → use merchant secret. **Recommend (a)** for the activation wizard. |
| `updateMerchantSettings(merchantId, body)`     | **Backend gap** — admin path missing; only `PATCH /merchants/:id/settings` (merchant principal) exists. Need `/admin/merchants/:id/settings`. |
| `updateSubMerchantSettings(...)`               | **Same gap** — need admin variant.                     |
| `uploadDocument(merchantId, file, type)`       | **Backend gap** — confirm via `documents.routes.ts`; admin upload path may be missing for the prototype's "Documents" step. |

> ⚠️ Claude Code: **Add the missing backend routes first** in `src/api/routes/admin.routes.ts` (mirror existing patterns: `requireAdmin`, `parseBody`, JSON envelope), then the `apps/admin/lib/api.ts` typed wrappers, then call from the Next.js wizard. Do not introduce a separate admin auth model.

---

## 6. Money handling

- All money in **minor units (cents)** as `bigint` in DB, surfaced as `number` through API normalisation (see `admin.routes.ts` line 482-486 for collections, 554-560 for payouts).
- Form inputs in KES → multiply by 100 before POST. See `compliance/new/page.tsx` line 11-17 for `kesToCents()` helper — reuse it.
- Display: divide by 100 + `.toLocaleString()` for thousands separators. See `app/page.tsx` line 47 for the pattern.

---

## 7. Settings inheritance pattern

`merchant_settings.sub_merchant_id IS NULL` = parent-level (applies to all sub-merchants by default).
`merchant_settings.sub_merchant_id = 'smrc_…'` = override row that wins for that sub.

Effective settings resolution: `settings.repository.ts` `resolveEffectiveSettings(merchantId, subMerchantId | null)`.

---

## 8. Things the prototype shows that the backend does NOT yet support

These are **prototype-only** — Claude Code must either add a backend feature or remove the UI:

1. **Step "Risk Assessment"** as a distinct UI stage — backend collapses risk into the AI/manual review pipeline. Either fold this into the review detail page or extend the compliance module.
2. **"Approve & advance to credentials" as one click** — backend is two POSTs (`/compliance-reviews/:id` with `approve` then `/merchants/:id/credentials`). Either chain on the frontend or add a backend convenience.
3. **Settings step before credentials** — backend requires `credentials_issued` first. Either reorder the UI or relax the auth on the settings PATCH.
4. **Sub-merchant creation in the wizard** — see §5 backend gap. Add `/admin/sub-merchants` or defer to post-activation.
5. **Aggregated admin dashboards (Collections / Payouts / Settlements summary cards with KPIs and sparklines)** — `/admin/collections` and `/admin/payouts` exist but return raw lists, not aggregations. Either compute client-side from the list (small data only) or add `/admin/collections/summary` and `/admin/payouts/summary` endpoints.
6. **Settlements admin endpoint** — backend has `settlements.routes.ts` for the merchant side; an admin variant (`/admin/settlements`) is **not present** in `admin.routes.ts`. Add it if you want the third aggregated dashboard from the prototype.

---

## 9. References to verify yourself before starting

```bash
# from /sessions/nifty-keen-albattani/OGUN
git log -1 --format="%H %s"     # should print 1124162b... + the subject
git status                       # should be clean
git rev-parse --abbrev-ref HEAD  # should print claude/payment-infrastructure-kenya-jzQmF
ls apps/admin/app                # confirms page directory layout
ls src/api/routes                # confirms route file inventory
ls src/modules                   # confirms module list
```

If any of the above diverge, **stop and re-validate** before writing code.

---

## 10. Drift summary — what's safe to assume

✅ **Safe:** state machine names, admin auth model, JSON envelope shape, money in cents, sub-merchant inheritance, sub-merchant settlement_preference enum, existing api.ts function signatures.

⚠️ **Drifted (must reconcile):** prototype state names, prototype step ordering, "approve → credentials → settings → activate" flow.

❌ **Missing (must add):** admin sub-merchant create, admin settings PATCH, admin settlements list, admin aggregation endpoints (or compute client-side), admin credentials-issue function in api.ts, admin suspend function in api.ts.
