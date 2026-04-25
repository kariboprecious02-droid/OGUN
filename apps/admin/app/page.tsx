import Link from 'next/link';
import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { listMerchants, listWallets, listCollections, listPayouts } from '@/lib/api';

export default async function Home(): Promise<React.ReactElement> {
  await requireAuth();

  // Parallel fetch of summary counts for each area
  const [pending, active, walletsPreview, collectionsPreview, payoutsPreview] = await Promise.all([
    listMerchants({ status: 'under_manual_review', limit: 1 }),
    listMerchants({ status: 'active', limit: 1 }),
    listWallets({ limit: 5 }),
    listCollections({ limit: 5 }),
    listPayouts({ limit: 5 }),
  ]);

  return (
    <Page title="Ogun Admin" subtitle="Payment infrastructure control plane">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard
          title="Pending review"
          value={pending.total}
          href="/compliance?status=under_manual_review"
          accent
        />
        <StatCard title="Active merchants" value={active.total} href="/compliance?status=active" />
        <StatCard title="Wallets" value={walletsPreview.total} href="/wallets" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="panel-padded">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent collections</h2>
            <Link href="/collections" className="text-sm">
              View all →
            </Link>
          </div>
          <ul className="divide-y divide-ogun-border text-sm">
            {collectionsPreview.items.length === 0 && (
              <li className="py-2 text-ogun-muted">No collections yet.</li>
            )}
            {collectionsPreview.items.map((c) => (
              <li key={c.id} className="py-2 flex items-center justify-between">
                <span className="mono truncate">{c.id}</span>
                <span className="text-ogun-muted">
                  {c.method} · {(c.amount / 100).toLocaleString()}
                </span>
                <span className={`badge badge-${c.business_status}`}>{c.business_status}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel-padded">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent payouts</h2>
            <Link href="/payouts" className="text-sm">
              View all →
            </Link>
          </div>
          <ul className="divide-y divide-ogun-border text-sm">
            {payoutsPreview.items.length === 0 && (
              <li className="py-2 text-ogun-muted">No payouts yet.</li>
            )}
            {payoutsPreview.items.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between">
                <span className="mono truncate">{p.id}</span>
                <span className="text-ogun-muted">
                  {p.method} · {(p.total_debit / 100).toLocaleString()}
                </span>
                <span className={`badge badge-${p.status}`}>{p.status}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Page>
  );
}

function StatCard({
  title,
  value,
  href,
  accent,
}: {
  title: string;
  value: number;
  href: string;
  accent?: boolean;
}): React.ReactElement {
  return (
    <Link href={href} className="no-underline">
      <div
        className={`panel-padded transition hover:border-ogun-accent-on-dark ${accent ? 'border-ogun-accent-on-dark' : ''}`}
      >
        <div className="text-sm text-ogun-muted">{title}</div>
        <div className="text-3xl font-bold mt-1">{value}</div>
      </div>
    </Link>
  );
}
