import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, listBeneficiaries, OgunApiError } from '@/lib/api';
import { PanelChrome } from '../_components/PanelChrome';
import { Badge, formatIsoDate } from '@/components/Badge';

export default async function MerchantBeneficiariesTab({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;
  let detail;
  try {
    detail = await getMerchantDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }
  const beneficiaries = await listBeneficiaries(id);

  const bankCount = beneficiaries.filter((b) => b.beneficiary_type === 'bank_account').length;
  const mobileCount = beneficiaries.filter((b) => b.beneficiary_type === 'mobile_money').length;
  const linkedCount = beneficiaries.filter((b) => b.provider_recipient_code).length;

  return (
    <PanelChrome
      merchant={detail.merchant}
      merchantId={id}
      currentTab="beneficiaries"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Total" value={String(beneficiaries.length)} />
        <Kpi label="Bank accounts" value={String(bankCount)} />
        <Kpi label="Mobile money" value={String(mobileCount)} />
        <Kpi label="Provider-linked" value={String(linkedCount)} sub="has recipient code" />
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-default w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Beneficiary ID</th>
              <th className="text-left">Name</th>
              <th className="text-left">Type</th>
              <th className="text-left">Account / Mobile</th>
              <th className="text-left">Bank code</th>
              <th className="text-left">Provider</th>
              <th className="text-left">Recipient code</th>
              <th className="text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {beneficiaries.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-ogun-muted py-8">
                  No beneficiaries yet — beneficiaries are created when a payout
                  destination is registered.
                </td>
              </tr>
            )}
            {beneficiaries.map((b) => (
              <tr key={b.id} className="border-t border-ogun-border hover:bg-ogun-bg/50">
                <td>
                  <Link
                    href={`/merchants/${id}/beneficiaries/${b.id}`}
                    className="mono text-xs no-underline text-ogun-accent-on-dark"
                  >
                    {b.id}
                  </Link>
                </td>
                <td>{b.name}</td>
                <td>
                  <Badge status={b.beneficiary_type === 'bank_account' ? 'bank' : 'mobile'} />
                </td>
                <td className="mono text-xs">
                  {b.account_number ?? b.mobile_number ?? '—'}
                </td>
                <td className="text-xs text-ogun-muted">{b.bank_code ?? '—'}</td>
                <td className="text-xs text-ogun-muted">{b.provider}</td>
                <td className="mono text-xs text-ogun-muted max-w-[140px] truncate">
                  {b.provider_recipient_code ?? '—'}
                </td>
                <td className="text-xs text-ogun-muted">{formatIsoDate(b.created_at)}</td>
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
