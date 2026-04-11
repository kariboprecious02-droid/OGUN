# Enabling Google Document AI

Ogun's compliance pipeline uses Google Document AI for Layer 1
extraction (§4.2.1). When credentials are not configured, the
pipeline falls back to a deterministic stub that returns empty field
values — useful for local development and tests, but insufficient
for production onboarding.

This guide walks through enabling the real Document AI integration.

## 1. Create the Google Cloud project

```bash
gcloud projects create ogun-production --name="Ogun Production"
gcloud config set project ogun-production

# Link a billing account (Document AI is a paid API)
gcloud beta billing projects link ogun-production \
  --billing-account=<BILLING_ACCOUNT_ID>

# Enable Document AI API
gcloud services enable documentai.googleapis.com
```

## 2. Create a Form Parser processor

Document AI is organized around **processors** — each one is
optimized for a class of document. For Ogun we recommend starting
with a single **Form Parser** processor that handles every
compliance document type (certificate of registration, KRA tax
certificate, director ID, bank confirmation). Later you can
specialize by creating dedicated processors for specific types.

Create the processor via the Cloud Console at
<https://console.cloud.google.com/ai/document-ai>:

1. Click **Create Processor**
2. Choose **Form Parser** under General processors
3. Name it `ogun-form-parser`
4. Pick the location (`us` or `eu` — note Kenya-relevant docs work
   fine in either)
5. Click **Create**

Copy the processor ID from the details pane — it looks like
`c1e5a4f7b23c8b9d`.

## 3. Create a service account

```bash
gcloud iam service-accounts create ogun-documentai \
  --display-name="Ogun Document AI"

# Grant the minimum role — documentai.apiUser can call processors
# but cannot create/delete them.
gcloud projects add-iam-policy-binding ogun-production \
  --member="serviceAccount:ogun-documentai@ogun-production.iam.gserviceaccount.com" \
  --role="roles/documentai.apiUser"

# Download a key file
gcloud iam service-accounts keys create ~/ogun-documentai.json \
  --iam-account=ogun-documentai@ogun-production.iam.gserviceaccount.com
```

## 4. Configure Ogun

Set these environment variables on the Ogun server (or in your
deployment's secret manager):

```bash
# Required
export GOOGLE_DOCUMENTAI_PROJECT_ID=ogun-production
export GOOGLE_DOCUMENTAI_LOCATION=us
export GOOGLE_DOCUMENTAI_PROCESSOR_ID=c1e5a4f7b23c8b9d

# Credentials — choose ONE of:
# (a) path to the service account JSON file
export GOOGLE_APPLICATION_CREDENTIALS=/etc/ogun/gcp-sa.json
# (b) or the inline JSON (useful for container deployments)
export GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
```

Restart Ogun. On startup, the extraction service will log:

```
extraction adapter = google document ai project=ogun-production location=us
```

From that moment on, every document uploaded to
`POST /v1/merchants/:id/documents` is sent to Document AI when the
merchant hits `POST /v1/merchants/:id/submit`. The adapter:

1. Fetches the raw bytes from Ogun's storage adapter
2. Sends them to Document AI with the correct processor
3. Maps the returned entities to Ogun's canonical field names
   (`company_name`, `registration_number`, `tax_id`, `id_number`,
   `bank_name`, `account_number`, `name`)
4. Rounds per-field confidence to 2 decimal places
5. Persists the extracted data to `documents.extracted_data`

The rest of the compliance pipeline (rules engine + Claude reasoning)
continues to operate exactly as before.

## 5. Per-document-type processors (optional)

If you want different processors for different document types
(e.g. a specialized Identity Document Processor for director IDs),
set per-type overrides:

```bash
export GOOGLE_DOCUMENTAI_PROCESSOR_COR=<cor-processor-id>
export GOOGLE_DOCUMENTAI_PROCESSOR_TAX=<tax-processor-id>
export GOOGLE_DOCUMENTAI_PROCESSOR_ID_DOC=<id-processor-id>
export GOOGLE_DOCUMENTAI_PROCESSOR_BANK=<bank-processor-id>
```

Each variable falls back to `GOOGLE_DOCUMENTAI_PROCESSOR_ID` when
unset, so you can migrate gradually.

## 6. Cost considerations

Document AI bills per page of every processed document. For
compliance onboarding this is typically 1–4 pages per document × 4
documents per merchant = 4–16 pages per onboarding. Form Parser
pricing at the time of writing is around $0.10 per page for the
first 1M pages / month.

Budget roughly **$0.40 – $1.60 per merchant onboarded**. Ogun caches
the extracted data in `documents.extracted_data` so re-processing is
free unless the document is replaced.

## 7. Troubleshooting

**"No Document AI processor configured for type X and no default set"**
Add either a per-type processor ID or set `GOOGLE_DOCUMENTAI_PROCESSOR_ID`.

**"Could not load the default credentials"**
Set `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS_JSON`.
If running on GKE / Cloud Run, make sure the service account attached
to the runtime has `roles/documentai.apiUser`.

**403 PERMISSION_DENIED**
The service account doesn't have access to the processor. Grant
`roles/documentai.apiUser` at the project level.

**Extracted fields are empty**
Form Parser returns entities based on what it can identify. Check
the raw Document AI response in the Cloud Console processor
playground to confirm the processor actually detects your fields.
For KRA PIN certificates specifically, consider training a custom
extractor via **Custom Document Extractor** for better results.

## 8. Falling back to the stub

To disable Document AI without redeploying, unset
`GOOGLE_DOCUMENTAI_PROJECT_ID`:

```bash
unset GOOGLE_DOCUMENTAI_PROJECT_ID
# restart Ogun
```

The extraction service will log:
```
extraction adapter = deterministic stub (GOOGLE_DOCUMENTAI_PROJECT_ID unset)
```

and compliance runs with the no-op stub. This is useful for
emergency fallbacks during a Document AI outage.

---

[← Back to index](./README.md)
