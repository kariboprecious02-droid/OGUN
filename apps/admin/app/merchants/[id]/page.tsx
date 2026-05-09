import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, getMerchantSettings, getMaskedCredentials, OgunApiError, centsToKes, type EffectiveSettings, type MaskedCredential } from '@/lib/api';
import { PanelChrome } from './_components/PanelChrome';
import { DevDocsTab } from './_components/DevDocsTab';
import { CredentialsPanel } from '@/components/CredentialsPanel';
import { DirtyFormGuard } from '@/components/DirtyFormGuard';
import {
  panelSaveMerchantSettingsAction,
  panelCreateSubMerchantAction,
  panelSuspendMerchantAction,
  panelRotateSecretKeyAction,
  panelRotateWebhookSecretAction,
  panelDismissRotationFlashAction,
  panelSendTestWebhookAction,
} from './actions';
import { Badge } from '@/components/Badge';

type RotationFlash = {
  kind: 'secret' | 'webhook_secret';
  environment: 'sandbox' | 'live';
  value: string;
};

type SettingsSubTab = 'profile' | 'accounts' | 'sub_merchants' | 'credentials' | 'dev_docs';

const SUB_TABS: ReadonlyArray<{ key: SettingsSubTab; label: string }> = [
  { key: 'profile', label: 'Profile' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'sub_merchants', label: 'Sub-merchants' },
  { key: 'credentials', label: 'Credentials' },
  { key: 'dev_docs', label: 'Dev Docs' },
];

const COLLECTION_METHODS = [
  { key: 'mpesa', label: 'M-Pesa STK Push' },
  { key: 'airtel', label: 'Airtel Money' },
  { key: 'till', label: 'Till' },
  { key: 'card', label: 'Card' },
  { key: 'bank', label: 'Bank transfer' },
] as const;

const PAYOUT_METHODS = [
  { key: 'mpesa', label: 'M-Pesa B2C' },
  { key: 'airtel', label: 'Airtel Disbursement' },
  { key: 'bank', label: 'Bank EFT' },
] as const;

const SETTLEMENT_FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const;

export default async function MerchantPanelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const subTab: SettingsSubTab = (typeof sp.tab === 'string' &&
    ['profile', 'accounts', 'sub_merchants', 'credentials', 'dev_docs'].includes(sp.tab)
    ? sp.tab
    : 'profile') as SettingsSubTab;
  const ok = typeof sp.ok === 'string' ? sp.ok : null;
  const errMsg = typeof sp.err === 'string' ? sp.err : null;

  let detail;
  let settings: EffectiveSettings | null = null;
  let maskedCreds: MaskedCredential[] = [];
  try {
    [detail, settings, maskedCreds] = await Promise.all([
      getMerchantDetail(id),
      getMerchantSettings(id).catch(() => null),
      getMaskedCredentials(id).catch(() => [] as MaskedCredential[]),
    ]);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  let rotationFlash: RotationFlash | null = null;
  if (subTab === 'credentials') {
    const flashCookie = (await cookies()).get(`rotated_${id}`)?.value;
    if (flashCookie) {
      try {
        const parsed = JSON.parse(flashCookie) as RotationFlash;
        if (parsed.kind && parsed.environment && parsed.value) {
          rotationFlash = parsed;
        }
      } catch {
        rotationFlash = null;
      }
    }
  }

  return (
    <DirtyFormGuard>
    <PanelChrome merchant={detail.merchant} merchantId={id} currentTab="settings">
      {/* sub-tab strip */}
      <nav
        aria-label="Settings sub-sections"
        className="mb-6 flex items-center gap-2 overflow-x-auto border-b border-ogun-border pb-3"
      >
        {SUB_TABS.map((s) => {
          const active = s.key === subTab;
          const cls = active
            ? 'text-ogun-accent-on-dark border-b-2 border-ogun-accent-on-dark'
            : 'text-ogun-muted hover:text-ogun-text';
          return (
            <Link
              key={s.key}
              href={`/merchants/${id}?tab=${s.key}`}
              aria-current={active ? 'page' : undefined}
              className={`px-3 py-1.5 text-sm whitespace-nowrap no-underline ${cls}`}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>

      {ok && (
        <div className="panel-padded mb-4 text-sm border border-emerald-700/50 bg-emerald-900/20 text-emerald-200">
          {ok === 'settings' && 'Merchant settings saved.'}
          {ok === 'sub-created' && 'Sub-merchant created.'}
          {ok === 'sub-settings' && 'Sub-merchant settings saved.'}
          {ok === 'suspended' && 'Merchant suspended.'}
          {ok === 'secret-rotated' && 'Secret key rotated. Copy it now — it will not be shown again.'}
          {ok === 'webhook-rotated' && 'Webhook secret rotated. Copy it now — it will not be shown again.'}
          {ok?.startsWith('webhook-test-') && `Webhook test succeeded (HTTP ${ok.replace('webhook-test-', '')}).`}
        </div>
      )}
      {errMsg && (
        <div className="panel-padded mb-4 text-sm border border-rose-700/50 bg-rose-900/20 text-rose-200">
          {errMsg}
        </div>
      )}

      {subTab === 'profile' && <ProfileTab merchant={detail.merchant} />}
      {subTab === 'accounts' && (
        <AccountsTab merchantId={id} settings={settings} />
      )}
      {subTab === 'sub_merchants' && (
        <SubMerchantsTab subMerchants={detail.sub_merchants} merchantId={id} />
      )}
      {subTab === 'credentials' && (
        <CredentialsPanel
          merchantId={id}
          maskedCredentials={maskedCreds}
          rotateSecretKeyAction={panelRotateSecretKeyAction}
          rotateWebhookSecretAction={panelRotateWebhookSecretAction}
          dismissFlashAction={panelDismissRotationFlashAction}
          flash={rotationFlash}
        />
      )}
      {subTab === 'dev_docs' && (
        <DevDocsTab
          merchantId={id}
          publishableKey={maskedCreds.find((c) => c.key_type === 'publishable' && c.environment === 'live')?.masked_value
            ?? maskedCreds.find((c) => c.key_type === 'publishable')?.masked_value
            ?? null}
          enabledCollectionMethods={settings?.enabled_methods ?? []}
          enabledPayoutMethods={settings?.enabled_payout_methods ?? []}
          webhookUrl={settings?.webhook_url ?? null}
          merchantStatus={detail.merchant.status}
          baseUrl={process.env.OGUN_API_BASE_URL ?? 'https://api.ogun.io/v1'}
        />
      )}
    </PanelChrome>
    </DirtyFormGuard>
  );
}

function ProfileTab({
  merchant,
}: {
  merchant: Awaited<ReturnType<typeof getMerchantDetail>>['merchant'];
}): React.ReactElement {
  const mAny = merchant as unknown as Record<string, unknown>;
  const monthly = mAny.expected_monthly_volume;
  const ticket = mAny.expected_avg_ticket;
  return (
    <div className="space-y-6">
      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Identity
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Kv k="Legal name" v={merchant.legal_name} />
          <Kv k="Trading name" v={merchant.trading_name} />
          <Kv k="Registration number" v={merchant.registration_number} mono />
          <Kv k="Tax ID" v={merchant.tax_id} mono />
          <Kv k="Country" v={merchant.country} />
          <Kv k="Settlement currency" v={merchant.settlement_currency} />
          <Kv k="Business category" v={merchant.business_category} />
          <Kv k="Status" v={merchant.status} mono />
        </dl>
      </section>

      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Volume expectations
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Kv
            k="Expected monthly volume"
            v={typeof monthly === 'number' ? `KES ${centsToKes(monthly).toLocaleString()}` : '—'}
          />
          <Kv
            k="Expected average ticket"
            v={typeof ticket === 'number' ? `KES ${centsToKes(ticket).toLocaleString()}` : '—'}
          />
        </dl>
      </section>

      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Primary contact
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Kv k="Name" v={merchant.contact_name} />
          <Kv k="Email" v={merchant.contact_email} />
          <Kv k="Phone" v={merchant.contact_phone} />
        </dl>
      </section>

      <section className="panel-padded border border-rose-700/40">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-300 mb-2">
          Suspend merchant
        </h2>
        <p className="text-xs text-ogun-muted mb-4">
          Suspended merchants cannot create new collections or payouts. Their
          existing balances remain. Reversible — admins can reinstate later.
        </p>
        <form action={panelSuspendMerchantAction} className="flex items-end gap-3">
          <input type="hidden" name="merchant_id" value={merchant.id} />
          <div className="flex-1">
            <label
              htmlFor="reason"
              className="block text-xs text-ogun-muted mb-1"
            >
              Reason
            </label>
            <input
              id="reason"
              name="reason"
              required
              className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
            />
          </div>
          <button
            type="submit"
            className="btn"
            disabled={merchant.status === 'suspended'}
          >
            Suspend
          </button>
        </form>
      </section>
    </div>
  );
}

function AccountsTab({
  merchantId,
  settings,
}: {
  merchantId: string;
  settings: EffectiveSettings | null;
}): React.ReactElement {
  const s = settings ?? {};
  const enabledCollSet = new Set(s.enabled_methods ?? []);
  const enabledPayoutSet = new Set(s.enabled_payout_methods ?? []);
  return (
    <div className="space-y-4">
    <form action={panelSaveMerchantSettingsAction} className="space-y-6">
      <input type="hidden" name="merchant_id" value={merchantId} />

      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Fees & settlement
        </h2>
        <p className="text-xs text-ogun-muted mb-4">
          Merchant-level settings. Sub-merchants may override these.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberField
            label="Collection fee %"
            name="collection_fee_pct"
            step="0.01"
            defaultValue={s.collection_fee_pct != null ? String(s.collection_fee_pct) : ''}
          />
          <SelectField
            label="Collection fee model"
            name="collection_fee_model"
            defaultValue={s.collection_fee_model ?? ''}
            options={[
              { value: 'merchant_covers', label: 'Merchant covers' },
              { value: 'payer_covers', label: 'Payer covers' },
            ]}
          />
          <NumberField
            label="Payout fee %"
            name="payout_fee_pct"
            step="0.01"
            defaultValue={s.payout_fee_pct != null ? String(s.payout_fee_pct) : ''}
          />
          <SelectField
            label="Payout fee model"
            name="payout_fee_model"
            defaultValue={s.payout_fee_model ?? ''}
            options={[
              { value: 'merchant_covers', label: 'Merchant covers' },
              { value: 'recipient_covers', label: 'Recipient covers' },
            ]}
          />
          <NumberField
            label="Settlement fee %"
            name="settlement_fee_pct"
            step="0.01"
            defaultValue={s.settlement_fee_pct != null ? String(s.settlement_fee_pct) : ''}
          />
          <SelectField
            label="Settlement frequency"
            name="settlement_frequency"
            defaultValue={s.settlement_frequency ?? 'weekly'}
            options={SETTLEMENT_FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
          />
        </div>
      </section>

      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Settlement account
        </h2>
        <p className="text-xs text-ogun-muted mb-4">
          Bank or mobile money account where settlement payouts are sent.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField
            label="Account holder name"
            name="settlement_account_holder"
            defaultValue={s.settlement_account_holder ?? ''}
          />
          <TextField
            label="Bank name"
            name="settlement_bank_name"
            defaultValue={s.settlement_bank_name ?? ''}
          />
          <TextField
            label="Account number"
            name="settlement_account_number"
            defaultValue={s.settlement_account_number ?? ''}
          />
          <TextField
            label="Branch / SWIFT code"
            name="settlement_branch_code"
            defaultValue={s.settlement_branch_code ?? ''}
          />
        </div>
      </section>

      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Enabled collection methods
        </h2>
        <div className="flex flex-wrap gap-3">
          {COLLECTION_METHODS.map((m) => (
            <label
              key={m.key}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
            >
              <input
                type="checkbox"
                name={`method_${m.key}`}
                defaultChecked={enabledCollSet.has(m.key)}
              />
              {m.label}
            </label>
          ))}
        </div>
        {enabledCollSet.size === 0 && (
          <p className="text-xs text-ogun-warn mt-2">
            This merchant cannot process collections — enable at least one method.
          </p>
        )}
      </section>

      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Enabled payout methods
        </h2>
        <div className="flex flex-wrap gap-3">
          {PAYOUT_METHODS.map((m) => (
            <label
              key={m.key}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
            >
              <input
                type="checkbox"
                name={`payout_method_${m.key}`}
                defaultChecked={enabledPayoutSet.has(m.key)}
              />
              {m.label}
            </label>
          ))}
        </div>
        {enabledPayoutSet.size === 0 && (
          <p className="text-xs text-ogun-warn mt-2">
            This merchant cannot process payouts — enable at least one method.
          </p>
        )}
      </section>

      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Webhook & notifications
        </h2>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label htmlFor="webhook_url" className="block text-sm text-ogun-muted mb-1">
              Webhook URL (HTTPS only)
            </label>
            <input
              id="webhook_url"
              name="webhook_url"
              type="url"
              defaultValue={s.webhook_url ?? ''}
              placeholder="https://your-server.com/webhooks/ogun"
              className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
            />
            <p className="text-xs text-ogun-muted mt-1">
              Ogun POSTs signed event notifications (collection status, payout status,
              settlements) to this URL. The merchant verifies signatures using
              their webhook signing secret.
            </p>
          </div>
          <div>
            <label htmlFor="notification_emails" className="block text-sm text-ogun-muted mb-1">
              Notification emails
            </label>
            <textarea
              id="notification_emails"
              name="notification_emails"
              rows={2}
              defaultValue={(s.notification_emails ?? []).join(', ')}
              placeholder="ops@example.com, finance@example.com"
              className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary">
          Save settings
        </button>
      </div>
    </form>

    <form action={panelSendTestWebhookAction}>
      <input type="hidden" name="merchant_id" value={merchantId} />
      <button
        type="submit"
        className="btn text-xs"
        disabled={!s.webhook_url}
        title={s.webhook_url ? 'Send a test ping to the webhook URL' : 'Set a webhook URL first'}
      >
        Send test webhook
      </button>
    </form>
    </div>
  );
}

function SubMerchantsTab({
  subMerchants,
  merchantId,
}: {
  subMerchants: Awaited<ReturnType<typeof getMerchantDetail>>['sub_merchants'];
  merchantId: string;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Sub-merchants ({subMerchants.length})
        </h2>
        {subMerchants.length === 0 ? (
          <p className="text-sm text-ogun-muted">No sub-merchants.</p>
        ) : (
          <ul className="divide-y divide-ogun-border">
            {subMerchants.map((s) => (
              <li key={s.id} className="py-3 flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-ogun-muted mt-0.5">
                    <span className="mono">{s.id}</span>
                    {s.code && <> · {s.code}</>}
                    {s.settlement_preference && <> · {s.settlement_preference}</>}
                  </div>
                </div>
                <Badge status={s.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-padded">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
          Add sub-merchant
        </h2>
        <form action={panelCreateSubMerchantAction} className="space-y-4">
          <input type="hidden" name="merchant_id" value={merchantId} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField label="Name *" name="sub_name" required />
            <TextField label="Code" name="sub_code" />
            <SelectField
              label="Settlement preference"
              name="sub_settlement_preference"
              options={[
                { value: 'daily', label: 'daily' },
                { value: 'weekly', label: 'weekly' },
                { value: 'monthly', label: 'monthly' },
                { value: 'on_demand', label: 'on_demand' },
              ]}
            />
            <TextField label="Bank name" name="sub_bank_name" />
            <TextField label="Account number" name="sub_account_number" />
            <TextField label="Branch code" name="sub_branch_code" />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="btn">
              Create sub-merchant
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Kv({
  k,
  v,
  mono,
}: {
  k: string;
  v: string | number | null | undefined;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div>
      <dt className="text-xs text-ogun-muted">{k}</dt>
      <dd className={mono ? 'mono text-sm' : 'text-sm'}>
        {v == null || v === '' ? '—' : String(v)}
      </dd>
    </div>
  );
}

function TextField({
  label,
  name,
  required,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
}): React.ReactElement {
  return (
    <div>
      <label htmlFor={name} className="block text-sm text-ogun-muted mb-1">
        {label}
      </label>
      <input
        id={name}
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
      />
    </div>
  );
}

function NumberField({
  label,
  name,
  step,
  defaultValue,
}: {
  label: string;
  name: string;
  step?: string;
  defaultValue?: string;
}): React.ReactElement {
  return (
    <div>
      <label htmlFor={name} className="block text-sm text-ogun-muted mb-1">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        step={step}
        min="0"
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
}): React.ReactElement {
  return (
    <div>
      <label htmlFor={name} className="block text-sm text-ogun-muted mb-1">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

