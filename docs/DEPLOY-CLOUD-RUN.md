# Ogun Deployment — Claude Co-work Instructions

## Context

You are deploying the Ogun payment infrastructure platform to Google Cloud.
The codebase is at: `https://github.com/kariboprecious02-droid/OGUN`
Branch: `claude/payment-infrastructure-kenya-jzQmF`

**Deploy TWO environments**: staging + production. Both use live
Paystack keys, live Document AI, real money. Only the databases are
separate so staging data does not mix with production data.

## Pre-existing resources (DO NOT recreate)

- GCP project: `project-ac6c08ce-0cde-4abd-828`
- Document AI Form Parser processor: `e6091cb0e4a52151` (us)
- Paystack live keys: ASK THE USER at Step 7

## STEP 1: Open Cloud Shell

Go to `https://console.cloud.google.com`, click the `>_` terminal
icon in the top-right. Then run:

```bash
gcloud config set project project-ac6c08ce-0cde-4abd-828
export REGION=us-central1
export PROJECT_ID=project-ac6c08ce-0cde-4abd-828
```

## STEP 2: Enable APIs

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  redis.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  vpcaccess.googleapis.com compute.googleapis.com
```

## STEP 3: Create VPC connector

```bash
gcloud compute networks vpc-access connectors create ogun-vpc \
  --region=$REGION --range=10.8.0.0/28
```

## STEP 4: Create Cloud SQL

```bash
gcloud sql instances create ogun-db \
  --database-version=POSTGRES_16 --tier=db-f1-micro \
  --region=$REGION --storage-size=10GB --storage-auto-increase \
  --no-assign-ip --network=default
```

Wait 5-8 minutes. Then:

```bash
DB_PASSWORD=$(openssl rand -base64 24)
gcloud sql users set-password postgres --instance=ogun-db --password="$DB_PASSWORD"
gcloud sql databases create ogun_prod --instance=ogun-db
gcloud sql databases create ogun_staging --instance=ogun-db
SQL_IP=$(gcloud sql instances describe ogun-db --format='value(ipAddresses[0].ipAddress)')
echo "SQL IP: $SQL_IP | Password: $DB_PASSWORD"
```

SAVE the password.

## STEP 5: Create Redis

```bash
gcloud redis instances create ogun-redis --size=1 --region=$REGION \
  --redis-version=redis_7_0 --tier=basic
```

Wait 3-5 minutes. Then:

```bash
REDIS_HOST=$(gcloud redis instances describe ogun-redis \
  --region=$REGION --format='value(host)')
echo "Redis: $REDIS_HOST (prod=db0, staging=db1)"
```

## STEP 6: Store secrets

**ASK THE USER** for their Paystack live secret key and public key
before running this step. They will paste the values.

```bash
SIGNING_SALT=$(openssl rand -base64 32)
echo -n "$DB_PASSWORD" | gcloud secrets create ogun-db-password --data-file=-
echo -n "PASTE_PAYSTACK_SECRET_KEY" | gcloud secrets create paystack-secret-key --data-file=-
echo -n "PASTE_PAYSTACK_PUBLIC_KEY" | gcloud secrets create paystack-public-key --data-file=-
echo -n "$SIGNING_SALT" | gcloud secrets create ogun-signing-salt --data-file=-
echo "ADMIN PASSWORD: $SIGNING_SALT"

PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for S in ogun-db-password paystack-secret-key paystack-public-key ogun-signing-salt; do
  gcloud secrets add-iam-policy-binding $S \
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" --quiet
done
```

SAVE the admin password.

## STEP 7: Clone and build

```bash
cd ~ && git clone https://github.com/kariboprecious02-droid/OGUN.git
cd OGUN && git checkout claude/payment-infrastructure-kenya-jzQmF
npm install
```

## STEP 8: Create Dockerfiles

```bash
cat > Dockerfile << 'EOF'
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci --ignore-scripts
COPY src/ src/
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
COPY src/infra/db/migrations ./dist/infra/db/migrations
EXPOSE 4000
CMD ["node", "dist/server.js"]
EOF

cat > apps/admin/next.config.js << 'EOF'
const nextConfig = { reactStrictMode: true, output: 'standalone',
  env: { OGUN_API_BASE_URL: process.env.OGUN_API_BASE_URL || 'http://localhost:4000/v1' } };
module.exports = nextConfig;
EOF

cat > apps/admin/Dockerfile << 'EOF'
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
EOF
```

## STEP 9: Deploy PRODUCTION API

```bash
cd ~/OGUN
gcloud run deploy ogun-api-prod --source=. --region=$REGION \
  --vpc-connector=ogun-vpc --port=4000 \
  --set-env-vars="NODE_ENV=production,PORT=4000,OGUN_ENV=live,\
DATABASE_URL=postgres://postgres:${DB_PASSWORD}@${SQL_IP}:5432/ogun_prod,\
REDIS_URL=redis://${REDIS_HOST}:6379/0,PAYSTACK_ENV=live,\
GOOGLE_DOCUMENTAI_PROJECT_ID=$PROJECT_ID,\
GOOGLE_DOCUMENTAI_LOCATION=us,\
GOOGLE_DOCUMENTAI_PROCESSOR_ID=e6091cb0e4a52151" \
  --set-secrets="PAYSTACK_SECRET_KEY=paystack-secret-key:latest,\
PAYSTACK_PUBLIC_KEY=paystack-public-key:latest,\
OGUN_WEBHOOK_SIGNING_SALT=ogun-signing-salt:latest" \
  --allow-unauthenticated --min-instances=1 --max-instances=10 \
  --memory=512Mi --cpu=1 --timeout=60

PROD_API=$(gcloud run services describe ogun-api-prod \
  --region=$REGION --format='value(status.url)')
echo "PROD API: $PROD_API"
```

## STEP 10: Deploy STAGING API

```bash
gcloud run deploy ogun-api-staging --source=. --region=$REGION \
  --vpc-connector=ogun-vpc --port=4000 \
  --set-env-vars="NODE_ENV=production,PORT=4000,OGUN_ENV=live,\
DATABASE_URL=postgres://postgres:${DB_PASSWORD}@${SQL_IP}:5432/ogun_staging,\
REDIS_URL=redis://${REDIS_HOST}:6379/1,PAYSTACK_ENV=live,\
GOOGLE_DOCUMENTAI_PROJECT_ID=$PROJECT_ID,\
GOOGLE_DOCUMENTAI_LOCATION=us,\
GOOGLE_DOCUMENTAI_PROCESSOR_ID=e6091cb0e4a52151" \
  --set-secrets="PAYSTACK_SECRET_KEY=paystack-secret-key:latest,\
PAYSTACK_PUBLIC_KEY=paystack-public-key:latest,\
OGUN_WEBHOOK_SIGNING_SALT=ogun-signing-salt:latest" \
  --allow-unauthenticated --min-instances=0 --max-instances=5 \
  --memory=512Mi --cpu=1 --timeout=60

STAGING_API=$(gcloud run services describe ogun-api-staging \
  --region=$REGION --format='value(status.url)')
echo "STAGING API: $STAGING_API"
```

## STEP 11: Run migrations on BOTH

```bash
IMG=$(gcloud run services describe ogun-api-prod \
  --region=$REGION --format='value(spec.template.spec.containers[0].image)')

gcloud run jobs create ogun-migrate-prod --image=$IMG --region=$REGION \
  --vpc-connector=ogun-vpc \
  --set-env-vars="DATABASE_URL=postgres://postgres:${DB_PASSWORD}@${SQL_IP}:5432/ogun_prod" \
  --command="node" --args="dist/infra/db/migrate.js" \
  --execute-now --wait

gcloud run jobs create ogun-migrate-staging --image=$IMG --region=$REGION \
  --vpc-connector=ogun-vpc \
  --set-env-vars="DATABASE_URL=postgres://postgres:${DB_PASSWORD}@${SQL_IP}:5432/ogun_staging" \
  --command="node" --args="dist/infra/db/migrate.js" \
  --execute-now --wait
```

## STEP 12: Seed BOTH

```bash
gcloud run jobs create ogun-seed-prod --image=$IMG --region=$REGION \
  --vpc-connector=ogun-vpc \
  --set-env-vars="DATABASE_URL=postgres://postgres:${DB_PASSWORD}@${SQL_IP}:5432/ogun_prod,\
REDIS_URL=redis://${REDIS_HOST}:6379/0" \
  --set-secrets="OGUN_WEBHOOK_SIGNING_SALT=ogun-signing-salt:latest" \
  --command="node" --args="dist/infra/db/seed.js" \
  --execute-now --wait

gcloud run jobs create ogun-seed-staging --image=$IMG --region=$REGION \
  --vpc-connector=ogun-vpc \
  --set-env-vars="DATABASE_URL=postgres://postgres:${DB_PASSWORD}@${SQL_IP}:5432/ogun_staging,\
REDIS_URL=redis://${REDIS_HOST}:6379/1" \
  --set-secrets="OGUN_WEBHOOK_SIGNING_SALT=ogun-signing-salt:latest" \
  --command="node" --args="dist/infra/db/seed.js" \
  --execute-now --wait

echo "Check seed logs for merchant credentials:"
gcloud logging read "resource.labels.job_name=ogun-seed-prod" --limit=20 --format='value(textPayload)' | head -20
gcloud logging read "resource.labels.job_name=ogun-seed-staging" --limit=20 --format='value(textPayload)' | head -20
```

## STEP 13: Verify APIs

```bash
echo "PROD:" && curl -sSL "$PROD_API/healthz"
echo && echo "STAGING:" && curl -sSL "$STAGING_API/healthz"
```

Both should return `{"status":"ok","service":"ogun","version":"4.1.0"}`.

## STEP 14: Deploy admin dashboards

```bash
cd ~/OGUN/apps/admin && npm install

gcloud run deploy ogun-admin-prod --source=. --region=$REGION --port=4001 \
  --set-env-vars="OGUN_API_BASE_URL=${PROD_API}/v1" \
  --allow-unauthenticated --min-instances=0 --max-instances=3 --memory=256Mi

gcloud run deploy ogun-admin-staging --source=. --region=$REGION --port=4001 \
  --set-env-vars="OGUN_API_BASE_URL=${STAGING_API}/v1" \
  --allow-unauthenticated --min-instances=0 --max-instances=2 --memory=256Mi

PROD_ADMIN=$(gcloud run services describe ogun-admin-prod --region=$REGION --format='value(status.url)')
STAGING_ADMIN=$(gcloud run services describe ogun-admin-staging --region=$REGION --format='value(status.url)')
echo "PROD ADMIN: $PROD_ADMIN"
echo "STAGING ADMIN: $STAGING_ADMIN"
```

## STEP 15: Configure Paystack webhook

Open `https://dashboard.paystack.com/#/settings/developers` in Chrome.
Set both Live Callback URL and Live Webhook URL to:
  `{PROD_API}/v1/webhooks/paystack`
(use the production API URL from Step 9). Click Save.

## STEP 16: Print summary

```bash
SALT=$(gcloud secrets versions access latest --secret=ogun-signing-salt)
echo "========================================"
echo "  OGUN DEPLOYMENT COMPLETE"
echo "========================================"
echo "  PRODUCTION:"
echo "    API:   $PROD_API"
echo "    Admin: $PROD_ADMIN"
echo "  STAGING:"
echo "    API:   $STAGING_API"
echo "    Admin: $STAGING_ADMIN"
echo "  Admin password: $SALT"
echo "  Both use: live Paystack, live Document AI, real money"
echo "  Databases: ogun_prod (prod) / ogun_staging (staging)"
echo "========================================"
```

Report all these values back to the user.

## How to update after deployment

```bash
cd ~/OGUN && git pull
gcloud run deploy ogun-api-staging --source=. --region=us-central1  # staging first
gcloud run deploy ogun-api-prod --source=. --region=us-central1     # then prod
```

## Cost: ~35-40 USD/month for both environments
