import { Badge } from '@/components/Badge';
import type { MerchantDetail } from '@/lib/api';

/**
 * Shows the merchant's identity + status above the wizard step content.
 * Renders below the JourneyBar, sticky to top of step content.
 */
export function MerchantHeader({
  merchant,
}: {
  merchant: MerchantDetail['merchant'];
}): React.ReactElement {
  return (
    <div className="max-w-7xl mx-auto px-6 pt-6 pb-2 flex items-center gap-3 flex-wrap">
      <div>
        <h1 className="text-xl font-semibold">
          {merchant.legal_name || merchant.trading_name || '(unnamed)'}
        </h1>
        <div className="text-xs text-ogun-muted mono">{merchant.id}</div>
      </div>
      <Badge status={merchant.status} />
      {merchant.country && (
        <span className="text-xs text-ogun-muted">· {merchant.country}</span>
      )}
    </div>
  );
}
