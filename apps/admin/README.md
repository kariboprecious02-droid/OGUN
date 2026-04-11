# Ogun Admin Console

Next.js 14 app for operating Ogun — compliance review, merchant
activation, wallet inspection, and dual-state transaction browsing.

## Running locally

```bash
npm install

# Point at your local backend (or a remote one)
export OGUN_API_BASE_URL=http://localhost:4000/v1

npm run dev
```

The dev server runs on **http://localhost:4001** to avoid colliding
with the Ogun backend on port 4000.

## Authentication

The admin console is gated by the Ogun platform admin secret
(`OGUN_WEBHOOK_SIGNING_SALT` on the backend). On the login screen
paste the secret value — it's verified via `POST /v1/admin/session`
and stored in an httpOnly cookie for the duration of the session
(8 hours).

The admin secret **never reaches the browser**. All API calls
originate from server components and server actions, where the cookie
is read and attached as the `X-Ogun-Admin-Secret` header.

## Pages

| Path | Purpose |
| --- | --- |
| `/` | Dashboard with pending review count + recent activity |
| `/login` | Admin secret login form |
| `/compliance` | Merchant queue with status filter |
| `/compliance/:id` | Full review: profile, docs, rules, AI recommendation, decision form |
| `/wallets` | Cross-merchant wallet browser |
| `/wallets/:id` | Wallet ledger entries (last 100) |
| `/collections` | Dual-state collection browser (shows both statuses) |
| `/payouts` | Payout browser with fee model + provider_status |

## Production deploy

```bash
npm run build
OGUN_API_BASE_URL=https://api.ogun.com/v1 npm start
```

Deploy anywhere Next.js 14 runs — Vercel, Cloud Run, or a VM.
The only runtime requirement is `OGUN_API_BASE_URL` pointing at
your Ogun backend.
