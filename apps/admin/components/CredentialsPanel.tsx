'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { formatIsoDate } from './Badge';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Credential = {
  key_type: 'publishable' | 'secret' | 'webhook_secret';
  environment: 'sandbox' | 'live';
  masked_value: string;
  is_active: boolean;
  created_at: string;
  rotated_at: string | null;
};

type Flash = {
  kind: 'secret' | 'webhook_secret';
  environment: 'sandbox' | 'live';
  value: string;
} | null;

type Props = {
  merchantId: string;
  maskedCredentials: Credential[];
  rotateSecretKeyAction: (formData: FormData) => Promise<void>;
  rotateWebhookSecretAction: (formData: FormData) => Promise<void>;
  dismissFlashAction: (formData: FormData) => Promise<void>;
  flash: Flash;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const KEY_TYPE_LABEL: Record<Credential['key_type'], string> = {
  publishable: 'Publishable key',
  secret: 'Secret key',
  webhook_secret: 'Webhook secret',
};

const ENVIRONMENTS: Array<'sandbox' | 'live'> = ['sandbox', 'live'];

function credentialFor(
  creds: Credential[],
  keyType: Credential['key_type'],
  env: 'sandbox' | 'live',
): Credential | undefined {
  return creds.find((c) => c.key_type === keyType && c.environment === env);
}

/* ------------------------------------------------------------------ */
/*  Copy button                                                        */
/* ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleCopy}
        className="btn text-xs px-2 py-1"
      >
        Copy
      </button>
      {copied && (
        <span className="text-xs text-ogun-success whitespace-nowrap">
          Copied!
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Credential row                                                     */
/* ------------------------------------------------------------------ */

function CredentialRow({ cred }: { cred: Credential | undefined; keyType: Credential['key_type'] }) {
  if (!cred) {
    return (
      <span className="text-ogun-muted text-xs italic">Not issued</span>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <code className="text-xs bg-ogun-bg border border-ogun-border rounded px-2 py-1 break-all select-all">
        {cred.masked_value}
      </code>
      <CopyButton text={cred.masked_value} />
      {!cred.is_active && (
        <span className="text-xs text-ogun-danger font-medium">Inactive</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Flash panel with countdown                                         */
/* ------------------------------------------------------------------ */

const FLASH_TTL_S = 30;

function FlashPanel({
  flash,
  merchantId,
  dismissFlashAction,
}: {
  flash: NonNullable<Flash>;
  merchantId: string;
  dismissFlashAction: (formData: FormData) => Promise<void>;
}) {
  const [secondsLeft, setSecondsLeft] = useState(FLASH_TTL_S);
  const dismissedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    dismissedRef.current = false;
    setSecondsLeft(FLASH_TTL_S);

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          return 0;
        }
        return next;
      });
    }, 1_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [flash.value]);

  useEffect(() => {
    if (secondsLeft === 0 && !dismissedRef.current) {
      dismissedRef.current = true;
      const fd = new FormData();
      fd.set('merchant_id', merchantId);
      dismissFlashAction(fd).catch(() => {});
    }
  }, [secondsLeft, merchantId, dismissFlashAction]);

  const kindLabel =
    flash.kind === 'secret' ? 'secret key' : 'webhook secret';

  return (
    <section className="panel-padded border border-amber-700/50 bg-amber-900/20">
      <div className="flex items-start justify-between gap-4 mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-200">
          New {kindLabel} — {flash.environment}
        </h2>
        <span className="text-xs text-amber-300 whitespace-nowrap tabular-nums">
          Hides in {secondsLeft}s
        </span>
      </div>

      <p className="text-xs text-amber-100/80 mb-3">
        Copy this value now. It is shown only once and cannot be retrieved later.
        The previous {kindLabel} for the {flash.environment} environment is now
        invalid.
      </p>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <pre className="mono text-xs bg-ogun-bg border border-ogun-border rounded-md px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all flex-1 min-w-0">
          {flash.value}
        </pre>
        <CopyButton text={flash.value} />
      </div>

      <form action={dismissFlashAction}>
        <input type="hidden" name="merchant_id" value={merchantId} />
        <button type="submit" className="btn text-sm">
          I have copied this — dismiss
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Environment section                                                */
/* ------------------------------------------------------------------ */

function EnvironmentSection({
  env,
  creds,
}: {
  env: 'sandbox' | 'live';
  creds: Credential[];
}) {
  const pub = credentialFor(creds, 'publishable', env);
  const secret = credentialFor(creds, 'secret', env);
  const webhook = credentialFor(creds, 'webhook_secret', env);

  const rows: Array<{
    keyType: Credential['key_type'];
    cred: Credential | undefined;
  }> = [
    { keyType: 'publishable', cred: pub },
    { keyType: 'secret', cred: secret },
    { keyType: 'webhook_secret', cred: webhook },
  ];

  return (
    <section className="panel-padded">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
        {env === 'sandbox' ? 'Sandbox' : 'Live'} credentials
      </h2>

      <div className="divide-y divide-ogun-border">
        {rows.map(({ keyType, cred }) => (
          <div key={keyType} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium mb-1">
                  {KEY_TYPE_LABEL[keyType]}
                </div>
                <CredentialRow cred={cred} keyType={keyType} />
                {cred && (
                  <div className="mt-1.5 text-xs text-ogun-muted">
                    Created {formatIsoDate(cred.created_at)}
                    {cred.rotated_at && (
                      <> · Rotated {formatIsoDate(cred.rotated_at)}</>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Rotate forms                                                       */
/* ------------------------------------------------------------------ */

function RotateForm({
  label,
  action,
  merchantId,
}: {
  label: string;
  action: (formData: FormData) => Promise<void>;
  merchantId: string;
}) {
  return (
    <section className="panel-padded">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
        {label}
      </h2>
      <form action={action} className="flex items-end gap-3 flex-wrap">
        <input type="hidden" name="merchant_id" value={merchantId} />
        <div>
          <label
            htmlFor={`env-${label.replace(/\s+/g, '-').toLowerCase()}`}
            className="block text-sm text-ogun-muted mb-1"
          >
            Environment
          </label>
          <select
            id={`env-${label.replace(/\s+/g, '-').toLowerCase()}`}
            name="environment"
            defaultValue="sandbox"
            className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
          >
            <option value="sandbox">sandbox</option>
            <option value="live">live</option>
          </select>
        </div>
        <button type="submit" className="btn">
          {label}
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main export                                                        */
/* ------------------------------------------------------------------ */

export function CredentialsPanel({
  merchantId,
  maskedCredentials,
  rotateSecretKeyAction,
  rotateWebhookSecretAction,
  dismissFlashAction,
  flash,
}: Props): React.ReactElement {
  return (
    <div className="space-y-6">
      {/* Flash banner for freshly rotated key */}
      {flash && (
        <FlashPanel
          flash={flash}
          merchantId={merchantId}
          dismissFlashAction={dismissFlashAction}
        />
      )}

      {/* Credential sections grouped by environment */}
      {ENVIRONMENTS.map((env) => (
        <EnvironmentSection
          key={env}
          env={env}
          creds={maskedCredentials}
        />
      ))}

      {/* Rotate actions */}
      <RotateForm
        label="Rotate secret key"
        action={rotateSecretKeyAction}
        merchantId={merchantId}
      />
      <RotateForm
        label="Rotate webhook secret"
        action={rotateWebhookSecretAction}
        merchantId={merchantId}
      />
    </div>
  );
}
