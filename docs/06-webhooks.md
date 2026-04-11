# F. Webhooks

Ogun webhooks deliver every state change in your account over HTTP.
They're the recommended way to drive your downstream systems because
the webhook is the source of truth — polling is a backup, not a
primary pattern.

## 1. Event types

| Event | When it fires |
| --- | --- |
| `merchant.activated` | Merchant passes compliance and wallets are created |
| `merchant.suspended` | Merchant is suspended by ops |
| `collection.created` | POST /v1/collections accepted |
| `collection.succeeded` | Provider confirms payment, wallet credited |
| `collection.failed` | Provider rejects OR 5-min TTL expires |
| `collection.refunded` | Full refund posted |
| `payout.created` | POST /v1/payouts accepted, reservation posted |
| `payout.succeeded` | Provider confirms disbursement |
| `payout.failed` | Reservation released, including insufficient balance |
| `payout.reversed` | Post-success reversal by provider |
| `settlement.paid` | Settlement completed + report rendered |
| `settlement.failed` | Settlement execution failed |

## 2. Register a webhook endpoint

```bash
curl -sSL https://sandbox.ogun.com/v1/webhook-endpoints \
  -H "Authorization: Bearer sk_test_..." \
  -d '{
    "url": "https://merchant.example.com/ogun/webhook",
    "subscribed_events": [
      "collection.succeeded",
      "collection.failed",
      "payout.succeeded",
      "payout.failed"
    ]
  }'
```

The response includes `webhook_secret` — **shown once**. Store it
securely and use it to verify incoming webhooks.

## 3. Payload format

```http
POST https://merchant.example.com/ogun/webhook HTTP/1.1
Content-Type: application/json
X-Ogun-Signature: sha256=abc123...
X-Ogun-Timestamp: 2026-04-05T10:30:45Z
X-Ogun-Event-Id: evt_01H...

{
  "id": "evt_01H...",
  "type": "collection.succeeded",
  "created_at": "2026-04-05T10:30:45Z",
  "data": {
    "collection_id": "col_01H...",
    "merchant_id": "mrc_01KWARA...",
    "sub_merchant_id": "smrc_01NAI...",
    "amount": 100000,
    "currency": "KES",
    "business_status": "successful",
    "provider_reference": "ws_CO_20260405..."
  }
}
```

Headers:
- **`X-Ogun-Signature`** — `sha256=<HMAC-SHA256(raw_body, webhook_secret)>`
- **`X-Ogun-Timestamp`** — ISO 8601 UTC of when the event was emitted.
  Reject events older than 5 minutes to defend against replay.
- **`X-Ogun-Event-Id`** — unique event ID (`evt_*`). Use this to
  dedupe if you've already processed the event.

## 4. Verify the signature

### Node.js

```js
import crypto from 'node:crypto';
import express from 'express';

const app = express();

app.post(
  '/ogun/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.header('X-Ogun-Signature');
    const expected =
      'sha256=' +
      crypto
        .createHmac('sha256', process.env.OGUN_WEBHOOK_SECRET)
        .update(req.body)
        .digest('hex');
    if (signature !== expected) return res.status(401).send('Invalid signature');

    const event = JSON.parse(req.body);
    if (await isProcessed(event.id)) return res.status(200).send('Already processed');

    switch (event.type) {
      case 'collection.succeeded':
        await fulfillOrder(event.data);
        break;
      case 'collection.failed':
        await notifyCustomerRetry(event.data);
        break;
      case 'payout.succeeded':
        await markVendorPaid(event.data);
        break;
    }
    await markProcessed(event.id);
    res.status(200).send('OK');
  }
);
```

### Python (Flask)

```python
import hmac
import hashlib
from flask import Flask, request, abort

app = Flask(__name__)
OGUN_SECRET = os.environ['OGUN_WEBHOOK_SECRET']

@app.post('/ogun/webhook')
def ogun_webhook():
    signature = request.headers.get('X-Ogun-Signature', '')
    expected = 'sha256=' + hmac.new(
        OGUN_SECRET.encode(),
        request.data,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        abort(401)

    event = request.get_json()
    if is_processed(event['id']):
        return 'Already processed', 200

    handle_event(event)
    mark_processed(event['id'])
    return 'OK', 200
```

## 5. Delivery guarantees

- **At-least-once**. Ogun retries any 4xx / 5xx response (except
  `401` which is treated as a signature failure and disables the
  endpoint after 100 consecutive failures).
- **Retry schedule**: 5s, 30s, 2min, 10min, 1hr, 6hr, 24hr (7 attempts).
- Acknowledge with `200` within 5 seconds. Process the event
  asynchronously — Ogun will retry if you return non-2xx.
- Always dedupe on `event.id` because (a) legitimate retries happen
  and (b) the poller can occasionally race with the webhook.

## 6. Test your endpoint

```bash
curl -sSL -X POST https://sandbox.ogun.com/v1/webhook-endpoints/wep_.../test \
  -H "Authorization: Bearer sk_test_..."
```

This queues a synthetic `merchant.activated` event aimed at the
specified endpoint so you can verify signature handling end-to-end.

## 7. Per-endpoint secrets

Each webhook endpoint you register has its own unique
`whsec_test_*` / `whsec_live_*` secret, stored AES-256-GCM encrypted
at rest and used to sign only that endpoint's deliveries. Rotating
the secret is a future feature — for now, delete the endpoint and
re-create it.

---

Next: [G. Testing](./07-testing.md)
