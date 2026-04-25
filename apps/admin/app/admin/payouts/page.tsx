import Link from 'next/link';
import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { listPayouts, listMerchants } from '@/lib/api';
import { Sparkline } from '../_components/Sparkline';
import { rollupPayouts, nameLookup } from '../_lib/aggregate';

export default async function AdminPayoutsDashboard(): Promise<React.ReactElement> {
  await requireAuth();

  const [payouts, merchants] = await Promise.all([
    listPayouts({ limit: 200 }),
    listMerchants({ limit: 200 }),
  ]);

  const rollup = rollupPayouts(payouts.items);
  const names = nameLookup(merchants.items);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Array<number>(7).fill(0);
  for (const p of payouts.items) {
    const t = new Date(p.created_at).getTime();
    const idx = 6 - Math.floor((now - t) / dayMs);
    if (idx >= 0 && idx < 7) buckets[idx] += Number(p.total_debit ?? p.amount ?? 0);
  }

  const perMerchant = Array.from(rollup.per_merchant.entries())
    .map(([id, v]) => ({
      id,
      name: names.get(id) ?? id,
      ...v,
      success_rate: v.count > 0 ? v.success_count / v.count : 0,
    }))
    .sort((a, b) => b.volume_cents - a.volume_cents);

  return (
    <Page
      title="Payouts — admin overview"
      subtitle="Cross-merchant volume and success rate, weighted by total debit."
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Kpi
          label="Volume (total debit)"
          value={`KES ${(rollup.volume_cents / 100).toLocaleString()}`}
          spark={buckets}
        />
        <Kpi label="Payouts" value={String(payouts.total)} />
        <Kpi
          label="Success rate (volume-weighted)"
          value={`${Math.round(rollup.success_rate * 100)}%`}
        />
        <Kpi label="Pending / failed" value={`${rollup.pending} / ${rollup.failed}`} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Volume</th>
              <th>Payouts</th>
              <th>Success rate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {perMerchant.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-ogun-muted py-8">
                  No payouts in the recent window.
                </td>
              </tr>
            )}
            {perMerchant.map((m) => (
              <tr key={m.id} className="border-t border-ogun-border">
                <td>
                  <Link
                    href={`/merchants/${m.id}/payouts`}
                    className="no-underline text-ogun-text hover:text-ogun-accent-on-dark"
                  >
                    {m.name}
                  </Link>
                  <div className="text-xs text-ogun-muted mono">{m.id}</div>
                </td>
                <td>KES {(m.volume_cents / 100).toLocaleString()}</td>
                <td>{m.count}</td>
                <td>{Math.round(m.success_rate * 100)}%</td>
                <td className="text-right">
                  <Link
                    href={`/merchants/${m.id}/payouts`}
                    className="text-xs text-ogun-accent-on-dark"
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
          <span className="text-ogun-accent-on-dark">
            <Sparkline values={spark} />
          </span>
        )}
      </div>
    </div>
  );
}
