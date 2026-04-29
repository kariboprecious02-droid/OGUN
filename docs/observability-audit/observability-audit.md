# Ogun Observability Audit — Collections Path End-to-End

**Audit subject:** github.com/kariboprecious02-droid/OGUN @ `d8ec2d4` (Paystack-default, spec §4.7 sync response)
**Trigger:** v1.2-d8ec2d4 verdict (HOLD on promote) — `provider_call_state: timed_out` after 1.5s with no provider_reference, polling never started, no webhook in 5 min, and no way to confirm whether Ogun ever reached Paystack
**Scope:** Read-only audit of the collections call path — POST `/v1/collections` → DB → connector → Paystack → polling/webhook → terminal state
**Goal:** Map exactly where the in-flight signal disappears today, and propose a fix in three layers with the merchant admin **Transaction Detail View** as the visible payoff
**Author:** Optimus Prime — CoS to PK
**Date:** 2026-04-28

---

## TL;DR

We cannot prove externally whether Ogun reached Paystack on run `1777377952` because the codebase has **exactly two log statements on the entire collections path** (one in the connector catch, one in the orchestrator catch) and **zero structured lifecycle records in the database** that an operator can query after the fact. The catch in `collection.service.ts:182` swallows the error after a single `logger.error` line, returns `{ provider_call_state: 'timed_out', next_action: null }`, and **does not enqueue a polling job** because the polling enqueue at `collection.service.ts:227` is gated on `next_action !== null`. That is the root cause of A1 and A2 from the v1.2 verdict.

The fix has three independent layers that compound:

| Layer | What | Visibility unlocked |
|---|---|---|
| **L1** | Axios request/response interceptor + structured per-step pino logs | Cloud Logging trace via `request_id`, complete with HTTP status, latency, response body excerpt |
| **L2** | New `collection_events` table — append-only lifecycle log per collection | Queryable lifecycle history; powers the polling-gate fix without spec change |
| **L3** | **Transaction Detail View** in `ogun-admin` — click a row in the collections list, see (1) 7-step journey stepper from Created through Settled showing exactly where it stopped, (2) partner API calls with request/response bodies, (3) wallet & settlement impact figures | Operator self-serve. PK / merchants no longer need to ask engineering to grep Cloud Logging |

Ship L1 + L2 together (they're co-dependent and instrument the same call sites). Ship L3 once the data is reliably populating. **L3 is the artefact that turns this from "an SRE feature" into a product feature** — see §6.

---

## 1. What we have today (catalog of every log statement on the collections path)

I walked the request from the route handler through to terminal-state resolution. Here is the **complete inventory** of log calls touching collections:

| File:Line | Level | Message | When it fires |
|---|---|---|---|
| `src/server.ts:20` | info | `'Ogun server listening'` | Process boot — once per pod |
| `src/server.ts:41` | error | `'poller tick failed'` | Wrapper catch around `tickPoller()` (interval mode) |
| `src/server.ts:57` | error | `'webhook dispatch tick failed'` | Wrapper catch around webhook dispatch loop |
| `src/api/routes/collections.routes.ts` | — | (none) | The entire 253-line routes file has **zero log statements** |
| `src/modules/collection/collection.service.ts:182` | error | `'provider dispatch timed out or errored'` | Outer catch in `dispatchToProviderSync` — **fired today** |
| `src/modules/connectors/paystack.collection.connector.ts:57` | error | `'paystack initiateCollection failed'` | Inner catch in connector `initiateCollection` |
| `src/modules/polling/polling.service.ts:103` | error | `'poller job failed'` | Per-job catch in `tickPoller` |

That is **seven log statements total** across the entire collections subsystem, and **five of them are error-only catches**. The two info-level statements are server boot and `'Ogun server listening'`.

---

## 2. What today's run actually did, traced through the code

Below is the actual code path for run `1777377952`, mapped against what we know happened.

```
POST /v1/collections
   ↓
src/api/routes/collections.routes.ts:35-79   (no log)
   ↓
authenticate() middleware                      (no log on this path)
   ↓
idempotency() middleware                       (no log on this path)
   ↓
parseBody(createBody, ...)                     (no log)
   ↓
createCollection({...})                        (no log on entry)
   in src/modules/collection/collection.service.ts
   ↓
   INSERT INTO collections (status='created') (no log of DB write)
   ↓
   pickCollectionProvider('mpesa')             (no log)
      → returns provider='paystack', connector=PaystackCollectionConnector
   ↓
   dispatchToProviderSync(row, connector)      (no log on entry)
   in src/modules/collection/collection.service.ts:163-274
      ↓
      try {
        await connector.initiateCollection({...})
           ↓
           in src/modules/connectors/paystack.collection.connector.ts:48-67
           ↓
           try {
             initiateMobileMoneyFlow({...})
                ↓
                this.http.post('/charge', body)  ← AXIOS CALL
                                                    NO INTERCEPTOR
                                                    NO LOG
                                                    timeout: 10_000ms
                                                    baseURL: config.paystack.baseUrl
                                                    Authorization: Bearer <secretKey>
                ↓
                ❌ THREW (we don't know what — fast-fail in 1.5s)
           } catch (err) {
             logger.error({ err, method }, 'paystack initiateCollection failed')  ← THIS LINE FIRED
             return { normalized_status: 'failed', next_action: 'escalate', error_code: 'provider_timeout' }
           }
        }
   ↓
      } catch (err) {
        logger.error({ err, collection_id }, 'provider dispatch timed out or errored')  ← THIS LINE FIRED
        return {
          business_status: Pending,
          provider_call_state: 'timed_out',
          next_action: null,
          provider_message: null,
          failure_reason: null,
        }
      }
   ↓
   if (result.next_action !== null && result.normalized_status !== 'failed') {
     await enqueuePollingJob({ ... })                 ← SKIPPED. next_action IS null.
   }
   ↓
   return result
   ↓
HTTP 201 with { provider_call_state: 'timed_out', provider_reference: null, ... }
```

---

## 3. The polling-enqueue gate is the load-bearing bug

`src/modules/collection/collection.service.ts` enqueues a polling job only when **both** of these are true:

```typescript
if (result.next_action !== null && result.normalized_status !== 'failed') {
  await enqueuePollingJob({...});
}
```

The outer catch at line 181-190 returns `next_action: null`. So the gate is `null !== null` → false → **no polling job is created.**

The 5-minute TTL-to-failed timeout (`timeoutCollection`) **also** only fires from inside `processJob`. So the collection is stuck at `pending/created` indefinitely.

**This is a spec gap, not an implementation bug.** This PR does NOT fix the gate — that's PR-2.

---

## 4. Why Cloud Logging alone won't fix this

1. **Log volume is too sparse.** Seven log statements on the path.
2. **Cloud Trace is disabled.**
3. **Operators cannot query Cloud Logging.** It requires GCP IAM.

---

## 5. The three-layer fix

### Layer 1 — Cloud Logging completeness

**1.1 Axios request/response interceptor** in both Paystack connectors. Redact `Authorization` headers and PII (phone, email) from logged bodies.

**1.2 AsyncLocalStorage request context.** `src/infra/requestContext.ts` so logs carry `{ request_id, merchant_id, collection_id }`.

**1.3 Two new info logs** in `dispatchToProviderSync`:
- Entry: `logger.info({ collection_id, provider, method }, 'dispatching to provider')`
- Exit: `logger.info({ collection_id, provider, normalized_status, provider_reference, latency_ms }, 'provider dispatch returned')`

### Layer 2 — `collection_events` lifecycle table

```sql
CREATE TABLE collection_events (
  id              text PRIMARY KEY,
  collection_id   text NOT NULL REFERENCES collections(id),
  event_type      text NOT NULL,
  source          text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  request_id      text,
  http_status     int,
  latency_ms      int,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  message         text
);
CREATE INDEX collection_events_collection_idx
  ON collection_events (collection_id, occurred_at);
CREATE INDEX collection_events_request_idx
  ON collection_events (request_id) WHERE request_id IS NOT NULL;
```

Event types: `api.received`, `api.validated`, `db.created`, `provider.requested`, `provider.responded`, `provider.errored`, `provider.timed_out`, `polling.enqueued`, `polling.skipped`, `polling.tick`, `polling.timeout`, `webhook.received`, `state.changed`, `wallet.credited`, `refund.requested`.

Helper: `recordCollectionEvent(input)` — fire-and-forget with `.catch(logErr)`.

### Layer 3 — Transaction Detail View (PR-3, out of scope)

---

## 7. PR plan

### PR-1: Lifecycle observability foundation (L1 + L2 bundled)

**Branch:** `feat/observability-foundation`
**Migration:** `src/infra/db/migrations/00NN_collection_events.sql`
**New code:**
- `src/infra/requestContext.ts`
- `src/api/middleware/requestContext.ts` (Express adapter)
- `src/modules/observability/collectionEvents.ts`

**Modified code:**
- `src/api/routes/collections.routes.ts` — `recordCollectionEvent('api.received'|'api.validated')`
- `src/modules/collection/collection.service.ts` — events for db.created, provider.timed_out, polling.skipped, polling.enqueued, state.changed; 2 info logs on dispatchToProviderSync
- `src/modules/connectors/paystack.collection.connector.ts` — axios interceptors
- `src/modules/connectors/paystack.payout.connector.ts` — same interceptors
- `src/modules/polling/polling.service.ts` — events for polling.tick, polling.timeout
- `src/api/routes/webhooks.routes.ts` — event for webhook.received

**Acceptance criteria:**
1. `SELECT event_type FROM collection_events WHERE collection_id = $1 ORDER BY occurred_at` returns the full lifecycle
2. Cloud Logging filter `jsonPayload.request_id="..."` returns ≥6 lines per request
3. All existing tests still pass; coverage on collection.service.ts does not decrease
4. New regression test: POST /collections with mocked Paystack 502 → assert lifecycle has all 6 expected events; AND a test for polling.skipped firing on the timed_out path
