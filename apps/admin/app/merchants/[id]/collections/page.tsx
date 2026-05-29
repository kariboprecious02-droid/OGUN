import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, listCollections, OgunApiError } from '@/lib/api';
import { PanelChrome } from '../_components/PanelChrome';
import { Badge, formatIsoDate } from '@/components/Badge';
import { CollectionFilters } from './_components/CollectionFilters';
import { CollectionColumnToggle, type ToggleCol } from './_components/CollectionColumnToggle';

const TOGGLE_COLS: ToggleCol[] = [
  { key: 'customer_email', label: 'Customer email' },
  { key: 'provider_reference', label: 'Provider reference' },
  { key: 'wallet_credited', label: 'Wallet credited' },
  { key: 'refund_status', label: 'Refund status' },
];

export default async function MerchantCollectionsTab({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  let detail;
  try {
    detail = await getMerchantDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  const filters: Record<string, string | undefined> = {
    status: typeof sp.status === 'string' ? sp.status : undefined,
    method: typeof sp.method === 'string' ? sp.method : undefined,
    from: typeof sp.from === 'string' ? sp.from : undefined,
    to: typeof sp.to === 'string' ? sp.to : undefined,
    search: typeof sp.search === 'string' ? sp.search : undefined,
  };

  const result = await listCollections({
    merchant_id: id,
    limit: 50,
    business_status: filters.status || undefined,
    method: filters.method || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    search: filters.search || undefined,
  });

  // Read toggled columns from cookie
  const cookieStore = await cookies();
  const toggleCookie = cookieStore.get('ogun_admin_collections_toggle_cols')?.value ?? '';
  const enabledToggleCols = new Set(toggleCookie.split(',').filter(Boolean));

  const attemptVolumeCents = result.items.reduce(
    (acc, c) => acc + Number(c.amount ?? 0),
    0,
  );
  const successfulItems = result.items.filter(
    (c) => c.business_status === 'successful',
  );
  const successVolumeCents = successfulItems.reduce(
    (acc, c) => acc + (Number(c.amount) - Number(c.fee_amount)),
    0,
  );
  const successRate = result.items.length
    ? successfulItems.length / result.items.length
    : 0;

  return (
    <PanelChrome
      merchant={detail.merchant}
      merchantId={id}
      currentTab="collections"
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Kpi
          label="Attempt volume"
          value={`KES ${(attemptVolumeCents / 100).toLocaleString()}`}
          sub={`${result.total} transaction${result.total === 1 ? '' : 's'}`}
        />
        <Kpi
          label="Net successful volume"
          value={`KES ${(successVolumeCents / 100).toLocaleString()}`}
          sub={`${successfulItems.length} succeeded`}
        />
        <Kpi label="Success rate" value={`${Math.round(successRate * 100)}%`} />
        <Kpi label="Total transactions" value={String(result.total)} />
      </div>

      {/* Filter bar */}
      <CollectionFilters
        merchantId={id}
        currentStatus={filters.status}
        currentMethod={filters.method}
        currentFrom={filters.from}
        currentTo={filters.to}
        currentSearch={filters.search}
      />

      <div className="panel overflow-x-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-ogun-border">
          <span className="text-xs text-ogun-muted">
            {result.total} transaction{result.total === 1 ? '' : 's'}
          </span>
          <CollectionColumnToggle
            columns={TOGGLE_COLS}
            enabledCols={Array.from(enabledToggleCols)}
          />
        </div>
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Collection ID</th>
              <th className="text-left">Sub-merchant</th>
              <th className="text-left">Method</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Fee</th>
              <th className="text-left">Status</th>
              <th className="text-left">Created</th>
              {enabledToggleCols.has('customer_email') && <th className="text-left">Customer email</th>}
              {enabledToggleCols.has('provider_reference') && <th className="text-left">Provider reference</th>}
              {enabledToggleCols.has('wallet_credited') && <th className="text-left">Wallet credited</th>}
              {enabledToggleCols.has('refund_status') && <th className="text-left">Refund status</th>}
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={7 + enabledToggleCols.size} className="text-center text-ogun-muted py-8">
                  No collections found for the selected filters. Try widening the date range or clearing filters.
                </td>
              </tr>
            )}
            {result.items.map((c) => (
              <tr key={c.id} className="border-t border-ogun-border hover:bg-ogun-bg/50">
                <td>
                  <Link href={`/merchants/${id}/collections/${c.id}`} className="mono text-xs no-underline text-ogun-accent-on-dark">
                    {c.id}
                  </Link>
                </td>
                <td className="text-xs">{(c as Record<string, unknown>).sub_merchant_name as string ?? c.sub_merchant_id}</td>
                <td>{c.method}</td>
                <td className="text-right">KES {(Number(c.amount) / 100).toLocaleString()}</td>
                <td className="text-right text-ogun-muted">KES {(Number(c.fee_amount) / 100).toLocaleString()}</td>
                <td>
                  {c.refund_status === 'partial_refund' ? (
                    <Badge status="partial_refund" />
                  ) : (
                    <Badge status={c.business_status} />
                  )}
                </td>
                <td className="text-xs text-ogun-muted">{formatIsoDate(c.created_at)}</td>
                {enabledToggleCols.has('customer_email') && (
                  <td className="text-xs text-ogun-muted max-w-[180px] truncate">{c.customer_email ?? '—'}</td>
                )}
                {enabledToggleCols.has('provider_reference') && (
                  <td className="mono text-xs text-ogun-muted max-w-[140px] truncate">{c.provider_reference ?? '—'}</td>
                )}
                {enabledToggleCols.has('wallet_credited') && (
                  <td className="text-xs">{c.wallet_credited ? 'yes' : 'no'}</td>
                )}
                {enabledToggleCols.has('refund_status') && (
                  <td className="text-xs text-ogun-muted">{c.refund_status ?? 'none'}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelChrome>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }): React.ReactElement {
  return (
    <div className="panel-padded">
      <div className="text-xs text-ogun-muted">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-ogun-muted mt-0.5">{sub}</div>}
    </div>
  );
}
