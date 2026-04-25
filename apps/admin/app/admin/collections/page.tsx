import Link from 'next/link';
import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { listCollections, listMerchants } from '@/lib/api';
import { Sparkline } from '../_components/Sparkline';
import { rollupCollections, nameLookup } from '../_lib/aggregate';

export default async function AdminCollectionsDashboard(): Promise<React.ReactElement> {
  await requireAuth();

  // Pull a wide page so the rollup is meaningful. Defer real aggregation
  // endpoints until volume justifies them.
  const [collections, merchants] = await Promise.all([
    listCollections({ limit: 200 }),
    listMerchants({ limit: 200 }),
  ]);

  const rollup = rollupCollections(collections.items);
  const names = nameLookup(merchants.items);

  // Build a 7-bucket time series of daily TPV (last 7 days). The list
  // endpoint orders by created_at desc; bucket on local-day.
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Array<number>(7).fill(0);
  for (const c of collections.items) {
    const t = new Date(c.created_at).getTime();
    const idx = 6 - Math.floor((now - t) / dayMs);
    if (idx >= 0 && idx < 7) buckets[idx] += Number(c.amount);
  }

  // Per-merchant breakdown sorted by TPV desc.
  const perMerchant = Array.from(rollup.per_merchant.entries())
    .map(([id, v]) => ({
      id,
      name: names.get(id) ?? id,
      ...v,
      success_rate: v.count > 0 ? v.success_count / v.count : 0,
    }))
    .sort((a, b) => b.tpv_cents - a.tpv_cents);

  return (
    <Page
      title="Collections — admin overview"
      subtitle="Cross-merchant aggregated KPIs and recent activity. Click a merchant to drill into their panel."
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Kpi
          label="TPV"
          value={`KES ${(rollup.tpv_cents / 100).toLocaleString()}`}
          spark={buckets}
        />
        <Kpi label="Transactions" value={String(collections.total)} />
        <Kpi
          label="Success rate (TPV-weighted)"
          value={`${Math.round(rollup.success_rate * 100)}%`}
        />
        <Kpi label="Pending / failed" value={`${rollup.pending} / ${rollup.failed}`} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th>Merchant</th>
              <th>TPV</th>
              <th>Transactions</th>
              <th>Success rate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {perMerchant.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-ogun-muted py-8">
                  No collections in the recent window.
                </td>
              </tr>
            )}
            {perMerchant.map((m) => (
              <tr key={m.id} className="border-t border-ogun-border">
                <td>
                  <Link
                    href={`/merchants/${m.id}/collections`}
                    className="no-underline text-ogun-text hover:text-ogun-accent"
                  >
                    {m.name}
                  </Link>
                  <div className="text-xs text-ogun-muted mono">{m.id}</div>
                </td>
                <td>KES {(m.tpv_cents / 100).toLocaleString()}</td>
                <td>{m.count}</td>
                <td>{Math.round(m.success_rate * 100)}%</td>
                <td className="text-right">
                  <Link
                    href={`/merchants/${m.id}/collections`}
                    className="text-xs text-ogun-accent"
                  >
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

function Kpi({
  label,
  value,
  spark,
}: {
  label: string;
  value: string;
  spark?: number[];
}): React.ReactElement {
  return (
    <div className="panel-padded">
      <div className="text-xs text-ogun-muted">{label}</div>
      <div className="flex items-end justify-between gap-3 mt-1">
        <div className="text-xl font-semibold">{value}</div>
        {spark && (
          <span className="text-ogun-accent">
            <Sparkline values={spark} />
          </span>
        )}
      </div>
    </div>
  );
}
