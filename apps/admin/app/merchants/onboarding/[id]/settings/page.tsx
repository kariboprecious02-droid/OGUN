import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, OgunApiError } from '@/lib/api';
import { OnboardingChrome } from '../../_components/OnboardingChrome';
import {
  saveMerchantSettingsAction,
  createSubMerchantAction,
} from './actions';

const METHODS = [
  { key: 'mpesa', label: 'M-Pesa' },
  { key: 'airtel', label: 'Airtel Money' },
  { key: 'till', label: 'Till' },
  { key: 'card', label: 'Card' },
  { key: 'bank', label: 'Bank transfer' },
] as const;

const SETTLEMENT_PREFS = ['daily', 'weekly', 'monthly', 'on_demand'] as const;

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const ok = typeof sp.ok === 'string' ? sp.ok : null;
  const errMsg = typeof sp.err === 'string' ? sp.err : null;

  let detail;
  try {
    detail = await getMerchantDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  // Settings come back from the merchant detail's effective resolution. The
  // server returns shape based on resolveEffectiveSettings; we rely on the
  // wrapper to default-fill if absent. For now, render empty inputs and let
  // the user re-save — this is the onboarding step where settings are first
  // configured.
  const m = detail.merchant;

  return (
    <OnboardingChrome merchant={m} merchantId={id} currentStep="settings">
      <div className="space-y-6 pt-4">
        <header>
          <h2 className="text-lg font-semibold">Step 3 — Settings</h2>
          <p className="text-sm text-ogun-muted mt-1">
            Configure fees, payment methods, and settlement preferences. You can
            also add additional sub-merchants here — each can override merchant-level
            settings.
          </p>
        </header>

        {ok && (
          <div className="panel-padded text-sm border border-emerald-700/50 bg-emerald-900/20 text-emerald-200">
            {ok === 'settings' && 'Merchant settings saved.'}
            {ok === 'sub-created' && 'Sub-merchant created.'}
            {ok === 'sub-settings' && 'Sub-merchant settings saved.'}
          </div>
        )}
        {errMsg && (
          <div className="panel-padded text-sm border border-rose-700/50 bg-rose-900/20 text-rose-200">
            {decodeURIComponent(errMsg)}
          </div>
        )}

        {/* Merchant-level settings */}
        <section className="panel-padded">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Merchant-level settings
          </h3>
          <form action={saveMerchantSettingsAction} className="space-y-4">
            <input type="hidden" name="merchant_id" value={id} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberField
                label="Collection fee %"
                name="collection_fee_pct"
                placeholder="1.5"
                step="0.01"
              />
              <SelectField
                label="Collection fee model"
                name="collection_fee_model"
                options={[
                  { value: 'merchant_covers', label: 'Merchant covers' },
                  { value: 'payer_covers', label: 'Payer covers' },
                ]}
              />
              <NumberField
                label="Payout fee %"
                name="payout_fee_pct"
                placeholder="1.0"
                step="0.01"
              />
              <SelectField
                label="Payout fee model"
                name="payout_fee_model"
                options={[
                  { value: 'merchant_covers', label: 'Merchant covers' },
                  { value: 'recipient_covers', label: 'Recipient covers' },
                ]}
              />
              <NumberField
                label="Settlement fee %"
                name="settlement_fee_pct"
                placeholder="0"
                step="0.01"
              />
            </div>

            <div>
              <div className="text-sm text-ogun-muted mb-2">Enabled payment methods</div>
              <div className="flex flex-wrap gap-3">
                {METHODS.map((m) => (
                  <label
                    key={m.key}
                    className="flex items-center gap-2 px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border text-sm"
                  >
                    <input
                      type="checkbox"
                      name={`method_${m.key}`}
                      defaultChecked={['mpesa', 'airtel'].includes(m.key)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="notification_emails"
                className="block text-sm text-ogun-muted mb-1"
              >
                Notification emails
              </label>
              <textarea
                id="notification_emails"
                name="notification_emails"
                rows={2}
                placeholder="ops@example.com, finance@example.com"
                className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent outline-none text-sm"
              />
            </div>

            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary">
                Save merchant settings
              </button>
            </div>
          </form>
        </section>

        {/* Sub-merchants list */}
        <section className="panel-padded">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted">
              Sub-merchants ({detail.sub_merchants.length})
            </h3>
          </div>

          {detail.sub_merchants.length === 0 ? (
            <p className="text-sm text-ogun-muted">No sub-merchants yet.</p>
          ) : (
            <ul className="divide-y divide-ogun-border">
              {detail.sub_merchants.map((s) => (
                <li key={s.id} className="py-3 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-ogun-muted mt-0.5">
                      <span className="mono">{s.id}</span>
                      {s.code && <> · {s.code}</>}
                      {s.settlement_preference && <> · {s.settlement_preference}</>}
                    </div>
                  </div>
                  <span className={`badge badge-${s.status}`}>{s.status}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Add sub-merchant form */}
          <details className="mt-4">
            <summary className="text-sm text-ogun-accent cursor-pointer">
              + Add sub-merchant
            </summary>
            <form action={createSubMerchantAction} className="space-y-4 mt-4">
              <input type="hidden" name="merchant_id" value={id} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextField
                  label="Sub-merchant name *"
                  name="sub_name"
                  required
                  placeholder="Tamasha Online Store"
                />
                <TextField
                  label="Code"
                  name="sub_code"
                  placeholder="TAM-001"
                />
                <SelectField
                  label="Settlement preference"
                  name="sub_settlement_preference"
                  options={SETTLEMENT_PREFS.map((p) => ({ value: p, label: p }))}
                />
                <TextField
                  label="Bank name"
                  name="sub_bank_name"
                  placeholder="Equity Bank Kenya"
                />
                <TextField
                  label="Account number"
                  name="sub_account_number"
                />
                <TextField
                  label="Branch code"
                  name="sub_branch_code"
                />
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn">
                  Create sub-merchant
                </button>
              </div>
            </form>
          </details>
        </section>

        <div className="flex items-center justify-between pt-4 border-t border-ogun-border">
          <Link
            href={`/merchants/onboarding/${id}/profile`}
            className="btn"
          >
            ← Back
          </Link>
          <Link
            href={`/merchants/onboarding/${id}/compliance`}
            className="btn btn-primary"
          >
            Continue to AI Compliance →
          </Link>
        </div>
      </div>
    </OnboardingChrome>
  );
}

function TextField({
  label,
  name,
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
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
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent outline-none text-sm"
      />
    </div>
  );
}

function NumberField({
  label,
  name,
  placeholder,
  step,
  defaultValue,
}: {
  label: string;
  name: string;
  placeholder?: string;
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
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent outline-none text-sm"
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
        className="w-full px-3 py-2 rounded-md bg-ogun-bg border border-ogun-border focus:border-ogun-accent outline-none text-sm"
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
