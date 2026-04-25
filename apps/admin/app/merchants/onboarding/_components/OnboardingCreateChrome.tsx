import { Nav } from '@/components/Nav';
import { JourneyBar } from './JourneyBar';

/**
 * Chrome for the wizard's pre-merchant "create" step. Same Nav + JourneyBar
 * layout as the rest of the wizard, but no merchant header (the merchant
 * doesn't exist yet) and downstream steps render as disabled placeholders.
 */
export function OnboardingCreateChrome({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-screen bg-ogun-bg text-ogun-text">
      <Nav />
      <JourneyBar merchantId={null} currentStep="create" />
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
