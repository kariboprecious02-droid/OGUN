import 'dotenv/config';

function required(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${key} is not a number`);
  return n;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  ogunEnv: (process.env.OGUN_ENV ?? 'sandbox') as 'sandbox' | 'live',
  port: int('PORT', 4000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  baseUrls: {
    api: process.env.OGUN_API_BASE_URL ?? 'http://localhost:4000/v1',
    sandbox: process.env.OGUN_SANDBOX_BASE_URL ?? 'https://sandbox.ogun.com/v1',
    production: process.env.OGUN_PRODUCTION_BASE_URL ?? 'https://api.ogun.com/v1',
  },

  db: {
    url: process.env.DATABASE_URL ?? 'postgres://ogun:ogun@localhost:5432/ogun_dev',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379/0',
  },

  safaricom: {
    env: process.env.SAFARICOM_ENV ?? 'sandbox',
    consumerKey: process.env.SAFARICOM_CONSUMER_KEY ?? '',
    consumerSecret: process.env.SAFARICOM_CONSUMER_SECRET ?? '',
    shortcode: process.env.SAFARICOM_SHORTCODE ?? '174379',
    passkey: process.env.SAFARICOM_PASSKEY ?? '',
    callbackUrl: process.env.SAFARICOM_CALLBACK_URL ?? '',
    baseUrl: process.env.SAFARICOM_BASE_URL ?? 'https://sandbox.safaricom.co.ke',
  },

  paystack: {
    env: process.env.PAYSTACK_ENV ?? 'test',
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY ?? '',
    baseUrl: process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co',
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET ?? '',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'eu-west-1',
    bucket: process.env.S3_BUCKET ?? 'ogun-documents',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },

  /**
   * Google Document AI (§4.2.1 — Layer 1 extraction).
   * Leave projectId blank to use the deterministic stub.
   */
  documentAI: {
    projectId: process.env.GOOGLE_DOCUMENTAI_PROJECT_ID ?? '',
    location: process.env.GOOGLE_DOCUMENTAI_LOCATION ?? 'us',
    // General-purpose processor used for every document type by default.
    // Override per-type processors via the record below if needed.
    defaultProcessorId: process.env.GOOGLE_DOCUMENTAI_PROCESSOR_ID ?? '',
    processorIdsByType: {
      certificate_of_registration: process.env.GOOGLE_DOCUMENTAI_PROCESSOR_COR ?? '',
      tax_certificate: process.env.GOOGLE_DOCUMENTAI_PROCESSOR_TAX ?? '',
      director_id: process.env.GOOGLE_DOCUMENTAI_PROCESSOR_ID_DOC ?? '',
      bank_confirmation: process.env.GOOGLE_DOCUMENTAI_PROCESSOR_BANK ?? '',
    } as Record<string, string>,
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '',
    credentialsJson: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? '',
  },

  email: {
    provider: process.env.EMAIL_PROVIDER ?? 'sendgrid',
    sendgridApiKey: process.env.SENDGRID_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? 'noreply@ogun.com',
  },

  platform: {
    webhookSigningSalt: process.env.OGUN_WEBHOOK_SIGNING_SALT ?? 'dev-salt',
    adminSecret: process.env.OGUN_ADMIN_SECRET ?? 'changeme-set-in-prod',
    idempotencyTtlSeconds: int('OGUN_IDEMPOTENCY_TTL_SECONDS', 86400),
  },

  connectors: {
    collectionProviderOverrides: process.env.COLLECTION_PROVIDER_OVERRIDES ?? '',
  },

  polling: {
    intervalSeconds: int('COLLECTION_POLL_INTERVAL_SECONDS', 5),
    ttlSeconds: int('COLLECTION_POLL_TTL_SECONDS', 300),
  },
} as const;

export type Config = typeof config;
