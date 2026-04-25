import Link from 'next/link';
import { STEPS, type WizardStepKey } from '../_lib/steps';

/**
 * Sticky journey bar shown at the top of every wizard step. Each step is a
 * `<Link>` so the admin can navigate freely (server-side derivation already
 * lands them at the right step from the merchant detail; this is just for
 * jump-back).
 */
export function JourneyBar({
  merchantId,
  currentStep,
}: {
  merchantId: string;
  currentStep: WizardStepKey;
}): React.ReactElement {
  return (
    <nav className="bg-ogun-surface border-b border-ogun-border">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((s) => {
          const active = s.key === currentStep;
          const cls = active
            ? 'bg-ogun-accent text-white'
            : 'bg-ogun-surface text-ogun-muted hover:bg-ogun-bg border border-ogun-border';
          return (
            <Link
              key={s.key}
              href={`/merchants/onboarding/${merchantId}/${s.key}`}
              className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap no-underline ${cls}`}
            >
              <span className="mono text-xs opacity-70 mr-1.5">{s.ordinal}</span>
              {s.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
