# Ogun Production Deployment — Claude Co-work Instructions

## Context

You are deploying the Ogun payment infrastructure platform to Google Cloud.
The codebase is complete and pushed to GitHub at:
  `https://github.com/kariboprecious02-droid/OGUN`
  Branch: `claude/payment-infrastructure-kenya-jzQmF`

The user is already logged into Google Cloud Console in Chrome.

## Pre-existing resources (DO NOT recreate)

- **GCP project ID**: `project-ac6c08ce-0cde-4abd-828`
- **Project number**: `552820821813`
- **Document AI processors** (already created):
  - Form Parser: `e6091cb0e4a52151` (region: `us`)
  - Document OCR: `43fdd1f5bc9721f8` (region: `us`)
- **Paystack live keys** (already obtained — ask the user for the values before Step 7; do NOT hardcode them in any file that gets committed)

## What you need to do

Deploy two Cloud Run services (ogun-api + ogun-admin) backed by
Cloud SQL (PostgreSQL) and Memorystore (Redis), then configure
Paystack webhook URLs to point at the live API.

---

## STEP 1: Open Google Cloud Shell

1. Navigate to `https://console.cloud.google.com`
2. Click the terminal icon `>_` in the top-right toolbar (next to
   the bell icon and profile picture)
3. Wait for Cloud Shell to initialize (shows a `$` prompt)
4. Verify the project is set:
   ```bash
   gcloud config set project project-ac6c08ce-0cde-4abd-828
   ```

All subsequent commands run in this Cloud Shell terminal.

## STEP 2: Enable required APIs

Run this single command (copy-paste the entire block):

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  vpcaccess.googleapis.com \
  compute.googleapis.com
```

Wait for it to complete (~30 seconds). You should see
"Operation finished successfully" for each API.

## STEP 3: Set region variable

```bash
export REGION=us-central1
echo "Region set to $REGION"
```

## STEP 4: Create VPC connector

Cloud Run needs this to reach Cloud SQL and Redis on the
private network.

```bash
gcloud compute networks vpc-access connectors create ogun-vpc \
  --region=$REGION \
  --range=10.8.0.0/28
```

Wait ~1 minute. Should print "Create request issued" then
eventually show the connector as READY.

## STEP 5: Create Cloud SQL PostgreSQL instance

```bash
gcloud sql instances create ogun-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=$REGION \
  --storage-size=10GB \
  --storage-auto-increase \
  --no-assign-ip \
  --network=default
```

This takes 5-8 minutes. Wait for it to finish.

Then create the database and set the password:

```bash
gcloud sql databases create ogun_prod --instance=ogun-db

# Generate a strong password
DB_PASSWORD=$(openssl rand -base64 24)
gcloud sql users set-password postgres \
  --instance=ogun-db \
  --password="$DB_PASSWORD"

# Save the connection details
SQL_CONNECTION=$(gcloud sql instances describe ogun-db \
  --format='value(connectionName)')
SQL_IP=$(gcloud sql instances describe ogun-db \
  --format='value(ipAddresses[0].ipAddress)')

echo "============================================"
echo "Cloud SQL created:"
echo "  Connection name: $SQL_CONNECTION"
echo "  Private IP: $SQL_IP"
echo "  Database: ogun_prod"
echo "  User: postgres"
echo "  Password: $DB_PASSWORD"
echo "============================================"
echo "SAVE THESE VALUES"
```

**IMPORTANT**: Copy and save the output. You need the password.

## STEP 6: Create Memorystore Redis instance

```bash
gcloud redis instances create ogun-redis \
  --size=1 \
  --region=$REGION \
  --redis-version=redis_7_0 \
  --tier=basic
```

This takes 3-5 minutes. Then get the host:

```bash
REDIS_HOST=$(gcloud redis instances describe ogun-redis \
  --region=$REGION \
  --format='value(host)')

echo "============================================"
echo "Redis created:"
echo "  Host: $REDIS_HOST"
echo "  Port: 6379"
echo "  URL: redis://$REDIS_HOST:6379/0"
echo "============================================"
```

## STEP 7: Store secrets in Secret Manager

```bash
# Generate a signing salt for Ogun
SIGNING_SALT=$(openssl rand -base64 32)

# Store each secret
echo -n "$DB_PASSWORD" | \
  gcloud secrets create ogun-db-password --data-file=-

# ASK THE USER for their Paystack live secret key and paste it here
echo -n "PASTE_PAYSTACK_SECRET_KEY_HERE" | \
  gcloud secrets create paystack-secret-key --data-file=-

# ASK THE USER for their Paystack live public key and paste it here
echo -n "PASTE_PAYSTACK_PUBLIC_KEY_HERE" | \
  gcloud secrets create paystack-public-key --data-file=-

echo -n "$SIGNING_SALT" | \
  gcloud secrets create ogun-signing-salt --data-file=-

echo "Signing salt (save this — it is the admin login password):"
echo "$SIGNING_SALT"

# Grant Cloud Run's default service account access to all secrets
PROJECT_NUMBER=$(gcloud projects describe project-ac6c08ce-0cde-4abd-828 \
  --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SECRET in ogun-db-password paystack-secret-key paystack-public-key ogun-signing-salt; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
done

echo "All secrets stored and permissions granted."
```

**IMPORTANT**: Save the signing salt output. This is the admin
dashboard login password.

## STEP 8: Clone the repo and build

```bash
cd ~
git clone https://github.com/kariboprecious02-droid/OGUN.git
cd OGUN
git checkout claude/payment-infrastructure-kenya-jzQmF

# Install dependencies
npm install
```

## STEP 9: Create the Dockerfile for the API

Create a file at `~/OGUN/Dockerfile` with this content:

```bash
cat > ~/OGUN/Dockerfile << 'DOCKERFILE_EOF'
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci --ignore-scripts
COPY src/ src/
RUN npm run build

# Stage 2: Runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
COPY src/infra/db/migrations ./dist/infra/db/migrations

EXPOSE 4000
CMD ["node", "dist/server.js"]
DOCKERFILE_EOF
```

## STEP 10: Create the Dockerfile for the admin dashboard

```bash
cat > ~/OGUN/apps/admin/Dockerfile << 'DOCKERFILE_EOF'
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 4001
ENV PORT=4001
CMD ["node", "server.js"]
DOCKERFILE_EOF
```

Then update the admin's next.config.js to enable standalone output:

```bash
cat > ~/OGUN/apps/admin/next.config.js << 'NEXTCONFIG_EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    OGUN_API_BASE_URL: process.env.OGUN_API_BASE_URL || 'http://localhost:4000/v1',
  },
};

module.exports = nextConfig;
NEXTCONFIG_EOF
```

## STEP 11: Deploy the API to Cloud Run

```bash
cd ~/OGUN

# Build and deploy in one command
gcloud run deploy ogun-api \
  --source=. \
  --region=$REGION \
  --vpc-connector=ogun-vpc \
  --port=4000 \
  --set-env-vars="\
NODE_ENV=production,\
PORT=4000,\
OGUN_ENV=live,\
DATABASE_URL=postgres://postgres:${DB_PASSWORD}@${SQL_IP}:5432/ogun_prod,\
REDIS_URL=redis://${REDIS_HOST}:6379/0,\
PAYSTACK_ENV=live,\
GOOGLE_DOCUMENTAI_PROJECT_ID=project-ac6c08ce-0cde-4abd-828,\
GOOGLE_DOCUMENTAI_LOCATION=us,\
GOOGLE_DOCUMENTAI_PROCESSOR_ID=e6091cb0e4a52151" \
  --set-secrets="\
PAYSTACK_SECRET_KEY=paystack-secret-key:latest,\
PAYSTACK_PUBLIC_KEY=paystack-public-key:latest,\
OGUN_WEBHOOK_SIGNING_SALT=ogun-signing-salt:latest" \
  --allow-unauthenticated \
  --min-instances=1 \
  --max-instances=10 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=60

# Confirm: it will ask "Do you want to continue?" — type Y
```

This takes 3-5 minutes (builds the Docker image in Cloud Build
and deploys). At the end it prints the service URL like:
  `https://ogun-api-XXXXX-uc.a.run.app`

**Save this URL.** Call it `API_URL`.

## STEP 12: Run database migrations

```bash
API_URL=$(gcloud run services describe ogun-api \
  --region=$REGION --format='value(status.url)')

# Run migrations by hitting a one-off Cloud Run job
gcloud run jobs create ogun-migrate \
  --image=$(gcloud run services describe ogun-api \
    --region=$REGION --format='value(spec.template.spec.containers[0].image)') \
  --region=$REGION \
  --vpc-connector=ogun-vpc \
  --set-env-vars="\
DATABASE_URL=postgres://postgres:${DB_PASSWORD}@${SQL_IP}:5432/ogun_prod" \
  --command="node" \
  --args="dist/infra/db/migrate.js" \
  --execute-now \
  --wait

echo "Migrations complete."
```

## STEP 13: Seed the production merchant

```bash
gcloud run jobs create ogun-seed \
  --image=$(gcloud run services describe ogun-api \
    --region=$REGION --format='value(spec.template.spec.containers[0].image)') \
  --region=$REGION \
  --vpc-connector=ogun-vpc \
  --set-env-vars="\
DATABASE_URL=postgres://postgres:${DB_PASSWORD}@${SQL_IP}:5432/ogun_prod,\
REDIS_URL=redis://${REDIS_HOST}:6379/0" \
  --set-secrets="\
OGUN_WEBHOOK_SIGNING_SALT=ogun-signing-salt:latest" \
  --command="node" \
  --args="dist/infra/db/seed.js" \
  --execute-now \
  --wait

echo "Seed complete. Check the logs for merchant credentials."

# View the seed output
gcloud run jobs executions list --job=ogun-seed --region=$REGION
EXEC_NAME=$(gcloud run jobs executions list --job=ogun-seed \
  --region=$REGION --format='value(name)' --limit=1)
gcloud logging read "resource.labels.job_name=ogun-seed" \
  --limit=30 --format='value(textPayload)'
```

**IMPORTANT**: The seed output contains the merchant's
`sk_test_*` credentials. Save them.

## STEP 14: Verify the API is live

```bash
API_URL=$(gcloud run services describe ogun-api \
  --region=$REGION --format='value(status.url)')

echo "API URL: $API_URL"
curl -sSL "$API_URL/healthz"
# Expected: {"status":"ok","service":"ogun","version":"4.1.0"}

curl -sSL "$API_URL/v1"
# Expected: {"name":"Ogun Payment Infrastructure Platform",...}
```

## STEP 15: Deploy the admin dashboard

```bash
cd ~/OGUN/apps/admin
npm install

API_URL=$(gcloud run services describe ogun-api \
  --region=us-central1 --format='value(status.url)')

gcloud run deploy ogun-admin \
  --source=. \
  --region=$REGION \
  --port=4001 \
  --set-env-vars="OGUN_API_BASE_URL=${API_URL}/v1" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=3 \
  --memory=256Mi \
  --cpu=1
```

Save the admin URL (printed at the end).

## STEP 16: Verify the admin dashboard

```bash
ADMIN_URL=$(gcloud run services describe ogun-admin \
  --region=$REGION --format='value(status.url)')
echo "Admin dashboard: $ADMIN_URL"
curl -sSL "$ADMIN_URL" | head -c 100
# Should return HTML containing "Ogun Admin"
```

Open this URL in Chrome. Log in with the signing salt value
saved from Step 7.

## STEP 17: Configure Paystack webhook URL

1. Open `https://dashboard.paystack.com/#/settings/developers`
   in Chrome
2. Scroll to the **API Configuration - Live Mode** section
3. Set **Live Callback URL** to:
   ```
   {API_URL}/v1/webhooks/paystack
   ```
   Replace `{API_URL}` with the Cloud Run URL from Step 14
   (e.g., `https://ogun-api-abc123-uc.a.run.app/v1/webhooks/paystack`)
4. Set **Live Webhook URL** to the same value
5. Click **Save changes**

## STEP 18: Optional — Map custom domains

If you own a domain (e.g., `ogun.com`):

```bash
# Map api.ogun.com
gcloud run domain-mappings create \
  --service=ogun-api \
  --domain=api.ogun.com \
  --region=$REGION

# Map admin.ogun.com
gcloud run domain-mappings create \
  --service=ogun-admin \
  --domain=admin.ogun.com \
  --region=$REGION

# GCP will print DNS records to add at your registrar
# (CNAME pointing to ghs.googlehosted.com)
```

After DNS propagates (~5 minutes), update the Paystack webhook
URL to `https://api.ogun.com/v1/webhooks/paystack`.

## STEP 19: Final verification checklist

Run each of these and confirm the expected output:

```bash
API_URL=$(gcloud run services describe ogun-api \
  --region=$REGION --format='value(status.url)')

# 1. Health check
curl -sSL "$API_URL/healthz"
# ✓ {"status":"ok","service":"ogun","version":"4.1.0"}

# 2. Metrics endpoint
curl -sSL "$API_URL/metrics" | head -5
# ✓ Should show Prometheus-format counters

# 3. Admin session check
SALT=$(gcloud secrets versions access latest --secret=ogun-signing-salt)
curl -sSL -X POST "$API_URL/v1/admin/session" \
  -H "X-Ogun-Admin-Secret: $SALT"
# ✓ {"status":"success","data":{"authenticated":true,...}}

# 4. List merchants (admin)
curl -sSL "$API_URL/v1/admin/merchants" \
  -H "X-Ogun-Admin-Secret: $SALT"
# ✓ Should show the seeded Kwara Kenya merchant

# 5. Paystack connectivity (create a test collection)
# Get the sk_test key from the seed logs, then:
# curl -sSL -X POST "$API_URL/v1/collections" ...
# (only if you have the merchant credentials from the seed)
```

## Summary of what was deployed

| Service | URL | Purpose |
|---------|-----|---------|
| ogun-api | `https://ogun-api-XXX.a.run.app` | Backend API (port 4000) |
| ogun-admin | `https://ogun-admin-XXX.a.run.app` | Admin dashboard (port 4001) |
| ogun-db | Private IP (Cloud SQL) | PostgreSQL 16 |
| ogun-redis | Private IP (Memorystore) | Redis 7 |

## Credentials to report back to the user

After completing all steps, report these values:

1. **API URL**: `https://ogun-api-XXX.a.run.app`
2. **Admin URL**: `https://ogun-admin-XXX.a.run.app`
3. **Admin login password**: (the signing salt from Step 7)
4. **Merchant credentials**: (from the seed output in Step 13)
5. **Paystack webhook configured**: yes/no

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Cloud Run deploy fails with "build error" | Check Dockerfile syntax; run `docker build .` locally first |
| "Connection refused" to Cloud SQL | Ensure VPC connector is in the same region as Cloud SQL |
| "ECONNREFUSED" to Redis | Same — VPC connector must be in same region as Memorystore |
| Migrations fail | Check DATABASE_URL format; ensure Cloud SQL is fully started |
| Paystack webhooks not arriving | Verify the webhook URL is exactly right; check Cloud Run logs |
| Admin dashboard shows "fetch failed" | OGUN_API_BASE_URL must point to the ogun-api Cloud Run URL with /v1 |
| "Permission denied" on secrets | Re-run the IAM binding commands from Step 7 |
