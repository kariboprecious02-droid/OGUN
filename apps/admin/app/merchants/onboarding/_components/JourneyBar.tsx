import Link from 'next/link';
import { STEPS, type WizardStepKey } from '../_lib/steps';

/**
 * Sticky journey bar shown at the top of every wizard step.
 *
 * - When `merchantId` is null (the merchant doesn't exist yet) only the
 *   "Create" step is rendered as active; the 6 downstream steps render as
 *   disabled placeholders so the admin sees the full journey upfront.
 * - When `merchantId` is set the steps render as `<Link>`s so the admin
 *   can jump freely.
 */
export function JourneyBar({
  merchantId,
  currentStep,
}: {
  merchantId: string | null;
  currentStep: WizardStepKey;
}): React.ReactElement {
  return (
    <nav className="bg-ogun-surface border-b border-ogun-border">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((s) => {
          const active = s.key === currentStep;
          const clickable = merchantId !== null && s.key !== 'create';
          const cls = active
            ? 'bg-ogun-accent text-white'
            : clickable
              ? 'bg-ogun-surface text-ogun-muted hover:bg-ogun-bg border border-ogun-border'
              : 'bg-ogun-surface text-ogun-muted/50 border border-ogun-border cursor-not-allowed';
          const content = (
            <>
              <span className="mono text-xs opacity-70 mr-1.5">{s.ordinal}</span>
              {s.label}
            </>
          );
          if (!clickable) {
            return (
              <span
                key={s.key}
                className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap ${cls}`}
              >
                {content}
              </span>
            );
          }
          return (
            <Link
              key={s.key}
              href={`/merchants/onboarding/${merchantId}/${s.key}`}
              className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap no-underline ${cls}`}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
