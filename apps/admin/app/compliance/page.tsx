import Link from 'next/link';
import { requireAuth } from '@/lib/session';
import { Page } from '@/components/Page';
import { Badge, formatIsoDate } from '@/components/Badge';
import { listMerchants } from '@/lib/api';

const STATUSES = [
  'submitted',
  'under_ai_review',
  'under_manual_review',
  'changes_requested',
  'approved',
  'rejected',
  'credentials_issued',
  'active',
  'suspended',
];

export default async function ComplianceListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : undefined;
  const search = typeof params.search === 'string' ? params.search : undefined;
  const page = typeof params.page === 'string' ? Number(params.page) : 1;
  const result = await listMerchants({ page, limit: 50, status, search });

  return (
    <Page
      title="Compliance review"
      subtitle={`${result.total} merchant${result.total === 1 ? '' : 's'} in view`}
    >
      <div className="flex items-center justify-end mb-3">
        <Link href="/merchants/onboarding/new" className="btn btn-primary">
          + Create merchant
        </Link>
      </div>
      <form method="get" className="flex items-center gap-3 mb-4">
        <select
          name="status"
          defaultValue={status ?? ''}
          className="bg-ogun-surface border border-ogun-border rounded-md px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="search"
          placeholder="Search name or ID"
          defaultValue={search ?? ''}
          className="bg-ogun-surface border border-ogun-border rounded-md px-3 py-2 text-sm flex-1 max-w-sm"
        />
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      <div className="panel overflow-x-auto">
        <table className="table-default">
          <thead>
            <tr>
              <th>Merchant ID</th>
              <th>Legal name</th>
              <th>Trading name</th>
              <th>Status</th>
              <th>Country</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-ogun-muted py-8">
                  No merchants match this filter.
                </td>
              </tr>
            )}
            {result.items.map((m) => {
              // Active/suspended merchants go straight to the post-activation
              // panel; all other statuses land in the onboarding wizard at
              // the appropriate step.
              const target =
                m.status === 'active' || m.status === 'suspended'
                  ? `/merchants/${m.id}`
                  : `/merchants/onboarding/${m.id}`;
              return (
                <tr key={m.id} className="hover:bg-ogun-bg/50">
                  <td className="mono">
                    <Link href={target} className="no-underline text-ogun-text hover:text-ogun-accent">
                      {m.id}
                    </Link>
                  </td>
                  <td>
                    <Link href={target} className="no-underline text-ogun-text hover:text-ogun-accent">
                      {m.legal_name}
                    </Link>
                  </td>
                  <td className="text-ogun-muted">{m.trading_name}</td>
                  <td>
                    <Badge status={m.status} />
                  </td>
                  <td>{m.country}</td>
                  <td className="text-ogun-muted">{formatIsoDate(m.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
