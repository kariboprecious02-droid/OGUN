/**
 * DevDocsTab — server component that renders personalized integration
 * documentation for a merchant, mirroring the structure of payment-provider
 * integration docs.  Interpolates the merchant's real credentials into
 * cURL samples so there are no `<placeholder>` strings.
 */

// ---------- props -----------------------------------------------------------

type Props = {
  merchantId: string;
  publishableKey: string | null;
  enabledCollectionMethods: string[];
  enabledPayoutMethods: string[];
  webhookUrl: string | null;
  merchantStatus: string;
  baseUrl: string;
};

// ---------- static data maps ------------------------------------------------

type FieldRow = {
  field: string;
  type: string;
  required: boolean;
  description: string;
};

type MethodSpec = {
  key: string;
  name: string;
  description: string;
  endpoint: string;
  fields: FieldRow[];
  sampleBody: Record<string, unknown>;
  response: Record<string, unknown>;
};

const SHARED_COLLECTION_FIELDS: FieldRow[] = [
  { field: 'amount', type: 'integer', required: true, description: 'Amount in the smallest currency unit (cents).' },
  { field: 'currency', type: 'string', required: true, description: 'ISO 4217 currency code. Currently "KES".' },
  { field: 'method', type: 'string', required: true, description: 'Payment method identifier.' },
];

const SHARED_PAYOUT_FIELDS: FieldRow[] = [
  { field: 'amount', type: 'integer', required: true, description: 'Amount in the smallest currency unit (cents).' },
  { field: 'currency', type: 'string', required: true, description: 'ISO 4217 currency code. Currently "KES".' },
  { field: 'method', type: 'string', required: true, description: 'Payout method identifier.' },
];

const COLLECTION_RESPONSE = {
  id: 'col_01HXYZ...',
  object: 'collection',
  status: 'pending',
  amount: 50000,
  currency: 'KES',
  method: '...',
  created_at: '2026-04-25T12:00:00Z',
};

const PAYOUT_RESPONSE = {
  id: 'pay_01HXYZ...',
  object: 'payout',
  status: 'pending',
  amount: 50000,
  currency: 'KES',
  method: '...',
  created_at: '2026-04-25T12:00:00Z',
};

function collectionMethods(baseUrl: string): MethodSpec[] {
  return [
    {
      key: 'mpesa',
      name: 'M-Pesa STK Push',
      description:
        'Initiates an STK (SIM Toolkit) push to the customer\'s phone. The customer confirms the payment on their device and the collection is completed in real time.',
      endpoint: `${baseUrl}/collections`,
      fields: [
        { field: 'phone', type: 'string', required: true, description: 'Customer phone number in E.164 format (e.g. "+254712345678").' },
        ...SHARED_COLLECTION_FIELDS,
      ],
      sampleBody: { phone: '+254712345678', amount: 50000, currency: 'KES', method: 'mpesa' },
      response: { ...COLLECTION_RESPONSE, method: 'mpesa' },
    },
    {
      key: 'airtel',
      name: 'Airtel Money',
      description:
        'Sends a push prompt to the customer\'s Airtel Money wallet. The customer approves on their handset and funds are collected.',
      endpoint: `${baseUrl}/collections`,
      fields: [
        { field: 'phone', type: 'string', required: true, description: 'Customer phone number in E.164 format (e.g. "+254733000000").' },
        ...SHARED_COLLECTION_FIELDS,
      ],
      sampleBody: { phone: '+254733000000', amount: 50000, currency: 'KES', method: 'airtel' },
      response: { ...COLLECTION_RESPONSE, method: 'airtel' },
    },
    {
      key: 'card',
      name: 'Card',
      description:
        'Charges a debit or credit card. Supply the full card details in a nested object. 3-D Secure may be required depending on the issuer.',
      endpoint: `${baseUrl}/collections`,
      fields: [
        { field: 'card.number', type: 'string', required: true, description: 'Card PAN (e.g. "4242424242424242").' },
        { field: 'card.exp_month', type: 'integer', required: true, description: 'Two-digit expiry month (1-12).' },
        { field: 'card.exp_year', type: 'integer', required: true, description: 'Four-digit expiry year.' },
        { field: 'card.cvv', type: 'string', required: true, description: 'Three or four-digit security code.' },
        ...SHARED_COLLECTION_FIELDS,
      ],
      sampleBody: {
        card: { number: '4242424242424242', exp_month: 12, exp_year: 2027, cvv: '123' },
        amount: 50000,
        currency: 'KES',
        method: 'card',
      },
      response: { ...COLLECTION_RESPONSE, method: 'card' },
    },
    {
      key: 'bank',
      name: 'Bank Transfer',
      description:
        'Returns virtual bank account details for the customer to transfer funds into. The collection completes once the bank confirms receipt.',
      endpoint: `${baseUrl}/collections`,
      fields: [...SHARED_COLLECTION_FIELDS],
      sampleBody: { amount: 50000, currency: 'KES', method: 'bank' },
      response: { ...COLLECTION_RESPONSE, method: 'bank' },
    },
    {
      key: 'till',
      name: 'Till',
      description:
        'Initiates a payment via a Lipa Na M-Pesa till number. The customer pays at a physical or virtual till and the collection completes upon confirmation.',
      endpoint: `${baseUrl}/collections`,
      fields: [
        { field: 'till_number', type: 'string', required: true, description: 'The till number to pay to (e.g. "5678901").' },
        ...SHARED_COLLECTION_FIELDS,
      ],
      sampleBody: { till_number: '5678901', amount: 50000, currency: 'KES', method: 'till' },
      response: { ...COLLECTION_RESPONSE, method: 'till' },
    },
  ];
}

function payoutMethods(baseUrl: string): MethodSpec[] {
  return [
    {
      key: 'mpesa',
      name: 'M-Pesa B2C',
      description:
        'Sends funds directly to a customer\'s M-Pesa wallet via Business-to-Customer (B2C) transfer.',
      endpoint: `${baseUrl}/payouts`,
      fields: [
        { field: 'phone', type: 'string', required: true, description: 'Recipient phone number in E.164 format (e.g. "+254712345678").' },
        ...SHARED_PAYOUT_FIELDS,
      ],
      sampleBody: { phone: '+254712345678', amount: 50000, currency: 'KES', method: 'mpesa' },
      response: { ...PAYOUT_RESPONSE, method: 'mpesa' },
    },
    {
      key: 'airtel',
      name: 'Airtel Disbursement',
      description:
        'Disburses funds to a recipient\'s Airtel Money wallet.',
      endpoint: `${baseUrl}/payouts`,
      fields: [
        { field: 'phone', type: 'string', required: true, description: 'Recipient phone number in E.164 format (e.g. "+254733000000").' },
        ...SHARED_PAYOUT_FIELDS,
      ],
      sampleBody: { phone: '+254733000000', amount: 50000, currency: 'KES', method: 'airtel' },
      response: { ...PAYOUT_RESPONSE, method: 'airtel' },
    },
    {
      key: 'bank',
      name: 'Bank Payout',
      description:
        'Transfers funds to a recipient\'s bank account. Requires the bank code and account number.',
      endpoint: `${baseUrl}/payouts`,
      fields: [
        { field: 'bank_code', type: 'string', required: true, description: 'Numeric bank code (e.g. "01" for KCB).' },
        { field: 'account_number', type: 'string', required: true, description: 'Recipient bank account number.' },
        ...SHARED_PAYOUT_FIELDS,
      ],
      sampleBody: { bank_code: '01', account_number: '1234567890', amount: 50000, currency: 'KES', method: 'bank' },
      response: { ...PAYOUT_RESPONSE, method: 'bank' },
    },
  ];
}

type ErrorRow = {
  http: number;
  code: string;
  message: string;
  when: string;
};

const ERROR_CODES: ErrorRow[] = [
  { http: 400, code: 'invalid_request', message: '(varies by field)', when: 'Request body or params failed validation' },
  { http: 401, code: 'unauthorized', message: 'Invalid API credentials', when: 'Bearer token missing or invalid' },
  { http: 403, code: 'forbidden', message: 'Insufficient permissions', when: 'Admin-only or scope-restricted endpoint' },
  { http: 404, code: 'resource_not_found', message: '<resource> not found', when: "The referenced object doesn't exist" },
  { http: 409, code: 'idempotency_conflict', message: 'Idempotency-Key reused with a different request body', when: 'Same Idempotency-Key, different payload' },
  { http: 409, code: 'duplicate_request', message: 'Duplicate request', when: 'A concurrent identical request is in flight' },
  { http: 422, code: 'merchant_not_active', message: 'Merchant <id> is not active', when: 'Merchant is not in active status' },
  { http: 422, code: 'sub_merchant_not_active', message: 'Sub-merchant <id> is not active', when: 'Sub-merchant is not active' },
  { http: 422, code: 'method_not_enabled', message: 'Method <m> is not enabled', when: 'Legacy method gate' },
  { http: 422, code: 'payout_methods_disabled', message: 'This merchant has no enabled payout methods. Enable at least one method in Settings → Accounts before processing payouts.', when: 'Payout attempted with empty enabled_payout_methods' },
  { http: 422, code: 'payout_method_not_enabled', message: "Payout method '<m>' is not enabled for this merchant.", when: 'Requested payout method not in the enabled set (details.enabled lists what IS enabled)' },
  { http: 422, code: 'collection_method_not_enabled', message: "Collection method '<m>' is not enabled for this merchant.", when: 'Requested collection method not enabled' },
  { http: 422, code: 'insufficient_payout_balance', message: 'Insufficient funds. Please fund your payout wallet and retry.', when: 'Payout wallet balance < total_debit (details has available_balance + required)' },
  { http: 422, code: 'compliance_pending', message: '(varies)', when: 'Action blocked pending compliance review' },
  { http: 422, code: 'wallet_frozen', message: 'Wallet is frozen. Unfreeze it before funding.', when: 'Funding attempted on a frozen wallet' },
  { http: 429, code: 'rate_limited', message: '(varies)', when: 'Too many requests; back off and retry' },
  { http: 502, code: 'provider_timeout', message: 'Provider <name> timed out', when: 'Upstream provider (Paystack) timed out' },
  { http: 502, code: 'provider_rejected', message: 'Provider <name> rejected: <reason>', when: 'Upstream provider returned an error' },
  { http: 500, code: 'internal_error', message: 'Internal server error', when: 'Unexpected server fault — safe to retry' },
];

const ERROR_RESPONSE_SHAPE = {
  status: 'error',
  error: {
    code: 'insufficient_payout_balance',
    message: 'Insufficient funds. Please fund your payout wallet and retry.',
    details: {},
  },
  meta: { request_id: 'req_...' },
};

const WEBHOOK_EVENTS = [
  'merchant.activated',
  'merchant.suspended',
  'collection.created',
  'collection.succeeded',
  'collection.failed',
  'collection.refunded',
  'payout.created',
  'payout.succeeded',
  'payout.failed',
  'payout.reversed',
  'settlement.paid',
  'settlement.failed',
] as const;

const EVENT_DESCRIPTIONS: Record<(typeof WEBHOOK_EVENTS)[number], string> = {
  'merchant.activated': 'The merchant has been activated and can process transactions.',
  'merchant.suspended': 'The merchant has been suspended by an admin.',
  'collection.created': 'A new collection has been initiated.',
  'collection.succeeded': 'A collection has been successfully completed.',
  'collection.failed': 'A collection attempt has failed.',
  'collection.refunded': 'A collection has been refunded to the payer.',
  'payout.created': 'A new payout has been initiated.',
  'payout.succeeded': 'A payout has been successfully completed.',
  'payout.failed': 'A payout attempt has failed.',
  'payout.reversed': 'A previously completed payout has been reversed.',
  'settlement.paid': "A settlement has been paid out to the merchant's bank account.",
  'settlement.failed': 'A settlement attempt has failed.',
};

// ---------- sub-components --------------------------------------------------

function FieldsTable({ fields }: { fields: FieldRow[] }): React.ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="table-default">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.field}>
              <td className="mono whitespace-nowrap">{f.field}</td>
              <td className="mono whitespace-nowrap">{f.type}</td>
              <td>{f.required ? 'Yes' : 'No'}</td>
              <td>{f.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ code }: { code: string }): React.ReactElement {
  return (
    <pre className="font-mono text-[13px] bg-ogun-bg border border-ogun-border rounded-md p-4 overflow-x-auto whitespace-pre-wrap break-all text-ogun-muted">
      {code}
    </pre>
  );
}

function CurlSample({
  endpoint,
  publishableKey,
  body,
}: {
  endpoint: string;
  publishableKey: string;
  body: Record<string, unknown>;
}): React.ReactElement {
  const curl = [
    `curl -X POST ${endpoint} \\`,
    `  -H "Authorization: Bearer ${publishableKey}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${JSON.stringify(body, null, 2)}'`,
  ].join('\n');

  return <CodeBlock code={curl} />;
}

function MethodSection({
  spec,
  publishableKey,
}: {
  spec: MethodSpec;
  publishableKey: string;
}): React.ReactElement {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-ogun-text">{spec.name}</h3>
      <p className="text-sm text-ogun-muted">{spec.description}</p>

      <div>
        <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
          Endpoint
        </div>
        <CodeBlock code={`POST ${spec.endpoint}`} />
      </div>

      <div>
        <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
          Request fields
        </div>
        <FieldsTable fields={spec.fields} />
      </div>

      <div>
        <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
          cURL example
        </div>
        <CurlSample
          endpoint={spec.endpoint}
          publishableKey={publishableKey}
          body={spec.sampleBody}
        />
      </div>

      <div>
        <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
          Response
        </div>
        <CodeBlock code={JSON.stringify(spec.response, null, 2)} />
      </div>
    </div>
  );
}

// ---------- main export -----------------------------------------------------

export function DevDocsTab({
  merchantId,
  publishableKey,
  enabledCollectionMethods,
  enabledPayoutMethods,
  webhookUrl,
  merchantStatus,
  baseUrl,
}: Props): React.ReactElement {
  const keyDisplay = publishableKey ?? `pk_${merchantStatus === 'active' ? 'live' : 'test'}_${merchantId.slice(0, 8)}`;

  const allCollections = collectionMethods(baseUrl);
  const allPayouts = payoutMethods(baseUrl);

  const enabledCollections = allCollections.filter((m) =>
    enabledCollectionMethods.includes(m.key),
  );
  const enabledPayouts = allPayouts.filter((m) =>
    enabledPayoutMethods.includes(m.key),
  );

  const isLive = merchantStatus === 'active';

  return (
    <div className="space-y-8">
      {/* ---- Sandbox / Live callout ---- */}
      {isLive ? (
        <div className="panel-padded border-ogun-success/50 bg-ogun-success/10 text-ogun-success">
          This merchant is live — requests process real money.
        </div>
      ) : (
        <div className="panel-padded border-ogun-warn/50 bg-ogun-warn/10 text-ogun-warn">
          This merchant is in sandbox mode — all requests hit the test environment.
        </div>
      )}

      {/* ---- Authentication ---- */}
      <section className="panel-padded space-y-3">
        <h2 className="text-lg font-semibold text-ogun-text">Authentication</h2>
        <p className="text-sm text-ogun-muted">
          All API requests require a Bearer token in the <span className="mono">Authorization</span> header.
          Use the publishable key for client-initiated requests.
        </p>
        <CodeBlock code={`Authorization: Bearer ${keyDisplay}`} />
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-ogun-muted">Merchant ID</dt>
            <dd className="mono">{merchantId}</dd>
          </div>
          <div>
            <dt className="text-xs text-ogun-muted">Publishable key</dt>
            <dd className="mono">{keyDisplay}</dd>
          </div>
          <div>
            <dt className="text-xs text-ogun-muted">Base URL</dt>
            <dd className="mono">{baseUrl}</dd>
          </div>
          {webhookUrl && (
            <div>
              <dt className="text-xs text-ogun-muted">Webhook URL</dt>
              <dd className="mono">{webhookUrl}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* ---- Errors ---- */}
      <section className="panel-padded space-y-4">
        <h2 className="text-lg font-semibold text-ogun-text">Errors</h2>
        <p className="text-sm text-ogun-muted">
          Errors are returned with a non-2xx HTTP status and a consistent JSON
          envelope. Inspect <span className="mono">error.code</span> for stable,
          machine-readable handling — the <span className="mono">message</span> is
          human-readable and may change.
        </p>

        <div>
          <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
            Error response shape
          </div>
          <CodeBlock code={JSON.stringify(ERROR_RESPONSE_SHAPE, null, 2)} />
        </div>

        <div>
          <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
            Error code reference
          </div>
          <div className="overflow-x-auto">
            <table className="table-default">
              <thead>
                <tr>
                  <th>HTTP</th>
                  <th>Code</th>
                  <th>Message</th>
                  <th>When it fires</th>
                </tr>
              </thead>
              <tbody>
                {ERROR_CODES.map((e) => (
                  <tr key={e.code}>
                    <td className="whitespace-nowrap">{e.http}</td>
                    <td className="mono whitespace-nowrap">{e.code}</td>
                    <td>{e.message}</td>
                    <td>{e.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
            Retry guidance
          </div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-ogun-muted">
            <li>
              5xx errors (<span className="mono">provider_timeout</span>,{' '}
              <span className="mono">provider_rejected</span>,{' '}
              <span className="mono">internal_error</span>) are retriable with
              exponential backoff.
            </li>
            <li>
              <span className="mono">rate_limited</span> (429) is retriable after
              the indicated cooldown.
            </li>
            <li>4xx errors are terminal — fix the request before retrying.</li>
            <li>
              <span className="mono">idempotency_conflict</span> means you reused
              an Idempotency-Key with a different body; generate a new key and
              retry.
            </li>
          </ul>
        </div>
      </section>

      {/* ---- Collections ---- */}
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-ogun-text">Collections</h2>

        {enabledCollections.length === 0 ? (
          <div className="panel-padded border-ogun-warn/50 bg-ogun-warn/10 text-ogun-warn text-sm">
            No collection methods enabled — configure in the Accounts tab.
          </div>
        ) : (
          <div className="space-y-8">
            {enabledCollections.map((spec) => (
              <div key={spec.key} className="panel-padded space-y-4">
                <MethodSection spec={spec} publishableKey={keyDisplay} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Payouts ---- */}
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-ogun-text">Payouts</h2>

        {enabledPayouts.length === 0 ? (
          <div className="panel-padded border-ogun-warn/50 bg-ogun-warn/10 text-ogun-warn text-sm">
            No payout methods are currently enabled for this merchant. Enable
            M-Pesa B2C, Airtel Disbursement, or Bank EFT under Settings →
            Accounts to expose payout API docs here.
          </div>
        ) : (
          <div className="space-y-8">
            {enabledPayouts.map((spec) => (
              <div key={spec.key} className="panel-padded space-y-4">
                <MethodSection spec={spec} publishableKey={keyDisplay} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Webhook Events ---- */}
      <section className="panel-padded space-y-4">
        <h2 className="text-lg font-semibold text-ogun-text">Webhook Events</h2>
        <p className="text-sm text-ogun-muted">
          Configure a webhook URL to receive real-time notifications for the
          following events. Events are delivered as <span className="mono">POST</span> requests
          with a JSON body.
        </p>

        <div>
          <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
            Subscribable events
          </div>
          <div className="overflow-x-auto">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {WEBHOOK_EVENTS.map((evt) => (
                  <tr key={evt}>
                    <td className="mono whitespace-nowrap">{evt}</td>
                    <td>{EVENT_DESCRIPTIONS[evt]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
            Signature verification
          </div>
          <p className="text-sm text-ogun-muted mb-2">
            Every webhook request includes an <span className="mono">X-Ogun-Signature</span> header
            containing an HMAC-SHA256 hex digest of the raw request body, signed
            with your webhook secret. Always verify the signature before
            processing the event.
          </p>
          <CodeBlock
            code={`import crypto from 'crypto';

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): boolean {
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signatureHeader, 'hex'),
  );
}`}
          />
        </div>

        <div>
          <div className="text-xs font-medium text-ogun-muted uppercase tracking-wide mb-2">
            Example webhook payload
          </div>
          <CodeBlock
            code={JSON.stringify(
              {
                id: 'evt_01HXYZ...',
                type: 'collection.succeeded',
                created_at: '2026-04-25T12:00:00Z',
                data: {
                  id: 'col_01HXYZ...',
                  object: 'collection',
                  status: 'succeeded',
                  amount: 50000,
                  currency: 'KES',
                  method: 'mpesa',
                  merchant_id: merchantId,
                },
              },
              null,
              2,
            )}
          />
        </div>
      </section>
    </div>
  );
}
