import Link from 'next/link';
import { Page } from '@/components/Page';

export default function OnboardingMerchantNotFound(): React.ReactElement {
  return (
    <Page
      title="Merchant not found"
      subtitle="The onboarding wizard could not load this merchant."
    >
      <div className="panel-padded">
        <p className="text-sm text-ogun-muted mb-4">
          The merchant ID in the URL may be incorrect, or the record may have
          been removed before activation.
        </p>
        <div className="flex gap-3">
          <Link href="/compliance" className="btn btn-primary">
            Back to compliance
          </Link>
          <Link href="/merchants/onboarding/new" className="btn">
            Create a new merchant
          </Link>
        </div>
      </div>
    </Page>
  );
}
