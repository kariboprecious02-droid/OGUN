import Link from 'next/link';
import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { listSettlements, listMerchants } from '@/lib/api';
import { Sparkline } from '../_components/Sparkline';
import { rollupSettlements, nameLookup } from '../_lib/aggregate';

export default async function AdminSettlementsDashboard(): Promise<React.ReactElement> {
  await requireAuth();

  const [settlements, merchants] = await Promise.all([
    listSettlements({ limit: 200 }),
    listMerchants({ limit: 200 }),
  ]);

  const rollup = rollupSettlements(settlements.items);
  const names = nameLookup(merchants.items);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Array<number>(7).fill(0);
  for (const s of settlements.items) {
    const t = new Date(s.updated_at ?? s.period_end).getTime();
    const idx = 6 - Math.floor((now - t) / dayMs);
    if (idx >= 0 && idx < 7) buckets[idx] += Number(s.net_amount ?? 0);
  }

  const perMerchant = Array.from(rollup.per_merchant.entries())
    .map(([id, v]) => ({
      id,
      name: names.get(id) ?? id,
      ...v,
    }))
    .sort((a, b) => b.gross_cents - a.gross_cents);

  return (
    <Page
      title="Settlements — admin overview"
      subtitle="Cross-merchant settlement gross and net totals."
    >
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <Kpi
          label="Gross settled"
          value={`KES ${(rollup.gross_cents / 100).toLocaleString()}`}
          spark={buckets}
        />
        <Kpi
          label="Settlement fee"
          value={`KES ${(rollup.settlement_fee_cents / 100).toLocaleString()}`}
        />
        <Kpi
          label="Net settled"
          value={`KES ${(rollup.net_cents / 100).toLocaleString()}`}
        />
        <Kpi
          label="Settled / scheduled"
          value={`${rollup.settled_count} / ${rollup.scheduled_count}`}
        />
        <Kpi label="Total settlements" value={String(settlements.total)} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Gross</th>
              <th>Settlement fee</th>
              <th>Net</th>
              <th>Count</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {perMerchant.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-ogun-muted py-8">
                  No settlements yet — once merchants settle, portfolio totals
                  appear here.
                </td>
              </tr>
            )}
            {perMerchant.map((m) => (
              <tr key={m.id} className="border-t border-ogun-border">
                <td>
                  <Link
                    href={`/merchants/${m.id}/settlements`}
                    className="no-underline text-ogun-text hover:text-ogun-accent-on-dark"
                  >
                    {m.name}
                  </Link>
                  <div className="text-xs text-ogun-muted mono">{m.id}</div>
                </td>
                <td>KES {(m.gross_cents / 100).toLocaleString()}</td>
                <td>KES {(m.settlement_fee_cents / 100).toLocaleString()}</td>
                <td>KES {(m.net_cents / 100).toLocaleString()}</td>
                <td>{m.count}</td>
                <td className="text-right">
                  <Link
                    href={`/merchants/${m.id}/settlements`}
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
