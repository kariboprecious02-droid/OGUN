import { Nav } from '@/components/Nav';
import { JourneyBar } from './JourneyBar';
import { MerchantHeader } from './MerchantHeader';
import type { MerchantDetail } from '@/lib/api';
import type { WizardStepKey } from '../_lib/steps';

/**
 * Wraps every wizard step with the standard Nav + JourneyBar + MerchantHeader.
 * Layouts can't derive the active route segment in Next 14 server components
 * without middleware, so each step page wraps its own content with this
 * component and passes its step key explicitly.
 */
export function OnboardingChrome({
  merchant,
  merchantId,
  currentStep,
  children,
}: {
  merchant: MerchantDetail['merchant'];
  merchantId: string;
  currentStep: WizardStepKey;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-screen bg-ogun-bg text-ogun-text">
      <Nav />
      <JourneyBar merchantId={merchantId} currentStep={currentStep} />
      <MerchantHeader merchant={merchant} />
      <main className="max-w-7xl mx-auto px-6 pb-12">{children}</main>
    </div>
  );
}
