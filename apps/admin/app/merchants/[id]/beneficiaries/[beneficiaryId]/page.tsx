import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getBeneficiaryDetail, getMerchantDetail, listPayouts, OgunApiError } from '@/lib/api';
import { Nav } from '@/components/Nav';
import { Badge, formatIsoDate } from '@/components/Badge';

export default async function BeneficiaryDetailPage({
  params,
}: {
  params: Promise<{ id: string; beneficiaryId: string }>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id, beneficiaryId } = await params;

  let detail;
  let b;
  try {
    const [d, ben] = await Promise.all([
      getMerchantDetail(id),
      getBeneficiaryDetail(beneficiaryId),
    ]);
    detail = d;
    b = ben;
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  const payoutsResult = await listPayouts({ merchant_id: id, limit: 50 });
  const linkedPayouts = payoutsResult.items.filter(
    (p) => p.beneficiary_id === beneficiaryId,
  );

  return (
    <div className="min-h-screen bg-ogun-bg text-ogun-text">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-4">
          <Link
            href={`/merchants/${id}/beneficiaries`}
            className="text-sm text-ogun-accent-on-dark no-underline"
          >
            &larr; Back to beneficiaries
          </Link>
        </div>

        {/* Header */}
        <section className="panel-padded mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-lg font-semibold">{b.name}</h1>
              <div className="mono text-xs text-ogun-muted mt-1">{b.id}</div>
              <div className="text-sm text-ogun-muted mt-1">
                {b.beneficiary_type === 'bank_account' ? 'Bank account' : 'Mobile money'}
                {' '}&middot; {b.provider} &middot; {b.currency}
              </div>
            </div>
            <Badge status={b.beneficiary_type === 'bank_account' ? 'bank' : 'mobile'} />
          </div>
        </section>

        {/* Account details */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Account details
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Kv k="Name" v={b.name} />
            <Kv k="Type" v={b.beneficiary_type} />
            <Kv k="Provider" v={b.provider} />
            <Kv k="Currency" v={b.currency} />
            {b.bank_code && <Kv k="Bank code" v={b.bank_code} mono />}
            {b.account_number && <Kv k="Account number" v={b.account_number} mono />}
            {b.mobile_number && <Kv k="Mobile number" v={b.mobile_number} mono />}
            <Kv k="Provider recipient code" v={b.provider_recipient_code} mono />
            <Kv k="Created" v={formatIsoDate(b.created_at)} />
          </dl>
        </section>

        {/* IDs */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            References
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Kv k="Beneficiary ID" v={b.id} mono />
            <Kv k="Merchant ID" v={b.merchant_id} mono />
            <Kv k="Sub-merchant ID" v={b.sub_merchant_id} mono />
          </dl>
        </section>

        {/* Linked payouts */}
        <section className="panel-padded mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Linked payouts ({linkedPayouts.length})
          </h2>
          {linkedPayouts.length === 0 ? (
            <p className="text-sm text-ogun-muted">
              No payouts have been sent to this beneficiary yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-default w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Payout ID</th>
                    <th className="text-right">Amount</th>
                    <th className="text-left">Status</th>
                    <th className="text-left">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedPayouts.map((p) => (
                    <tr key={p.id} className="border-t border-ogun-border hover:bg-ogun-bg/50">
                      <td>
                        <Link
                          href={`/merchants/${id}/payouts/${p.id}`}
                          className="mono text-xs no-underline text-ogun-accent-on-dark"
                        >
                          {p.id}
                        </Link>
                      </td>
                      <td className="text-right">
                        KES {(Number(p.recipient_amount) / 100).toLocaleString()}
                      </td>
                      <td><Badge status={p.status} /></td>
                      <td className="text-xs text-ogun-muted">{formatIsoDate(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Kv({ k, v, mono }: { k: string; v: string | number | null | undefined; mono?: boolean }): React.ReactElement {
  return (
    <div>
      <dt className="text-xs text-ogun-muted">{k}</dt>
      <dd className={mono ? 'mono text-sm' : 'text-sm'}>
        {v == null || v === '' ? <span className="italic text-ogun-muted">null</span> : String(v)}
      </dd>
    </div>
  );
}
