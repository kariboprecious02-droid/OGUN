import Link from 'next/link';
import { Page } from '@/components/Page';

export default function MerchantNotFound(): React.ReactElement {
  return (
    <Page
      title="Merchant not found"
      subtitle="No merchant matches that ID, or it has been deleted."
    >
      <div className="panel-padded">
        <p className="text-sm text-ogun-muted mb-4">
          Double-check the URL, or return to the compliance list to find the
          merchant.
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
