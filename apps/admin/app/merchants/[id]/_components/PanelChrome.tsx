import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Badge } from '@/components/Badge';
import type { MerchantDetail } from '@/lib/api';

export type PanelTabKey = 'settings' | 'collections' | 'payouts' | 'settlements';

const TABS: ReadonlyArray<{ key: PanelTabKey; label: string }> = [
  { key: 'settings', label: 'Settings' },
  { key: 'collections', label: 'Collections' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'settlements', label: 'Settlements' },
];

/**
 * Wraps every merchant-panel tab page with the standard Nav, merchant
 * identity header, and tab strip.
 */
export function PanelChrome({
  merchant,
  merchantId,
  currentTab,
  children,
}: {
  merchant: MerchantDetail['merchant'];
  merchantId: string;
  currentTab: PanelTabKey;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-screen bg-ogun-bg text-ogun-text">
      <Nav />
      <div className="bg-ogun-surface border-b border-ogun-border">
        <div className="max-w-7xl mx-auto px-6 pt-5 pb-2 flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-xl font-semibold">
              {merchant.legal_name || merchant.trading_name}
            </div>
            <div className="text-xs text-ogun-muted mono">{merchant.id}</div>
          </div>
          <Badge status={merchant.status} />
          {merchant.country && (
            <span className="text-xs text-ogun-muted">· {merchant.country}</span>
          )}
        </div>
        <div className="max-w-7xl mx-auto px-6 pb-3 flex items-center gap-2 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.key === currentTab;
            const cls = active
              ? 'bg-ogun-accent text-white'
              : 'bg-ogun-surface text-ogun-muted hover:bg-ogun-bg border border-ogun-border';
            const href =
              t.key === 'settings'
                ? `/merchants/${merchantId}`
                : `/merchants/${merchantId}/${t.key}`;
            return (
              <Link
                key={t.key}
                href={href}
                className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap no-underline ${cls}`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
