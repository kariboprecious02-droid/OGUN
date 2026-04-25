import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/session';
import { getMerchantDetail, OgunApiError } from '@/lib/api';
import { OnboardingChrome } from '../../_components/OnboardingChrome';
import {
  REQUIRED_DOC_TYPES,
  OPTIONAL_DOC_TYPES,
  DOC_TYPE_LABELS,
  type DocType,
} from '../../_lib/steps';
import { uploadDocAction } from './actions';

export default async function PeopleDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  await requireAuth();
  const { id } = await params;
  const sp = await searchParams;
  const okType = typeof sp.ok === 'string' ? sp.ok : null;
  const errMsg = typeof sp.err === 'string' ? sp.err : null;

  let detail;
  try {
    detail = await getMerchantDetail(id);
  } catch (err) {
    if (err instanceof OgunApiError && err.status === 404) notFound();
    throw err;
  }

  // Group documents by type. Backend allows multiple uploads per type;
  // for the four required types we just need >=1; for director_id we
  // expect one row per director.
  const byType = new Map<string, typeof detail.documents>();
  for (const d of detail.documents) {
    const list = byType.get(d.type) ?? [];
    list.push(d);
    byType.set(d.type, list);
  }
  const directorDocs = byType.get('director_id') ?? [];

  return (
    <OnboardingChrome
      merchant={detail.merchant}
      merchantId={id}
      currentStep="people-documents"
    >
      <div className="space-y-6 pt-4">
        <header>
          <h2 className="text-lg font-semibold">Step 1 — People & Documents</h2>
          <p className="text-sm text-ogun-muted mt-1">
            Upload the four required compliance documents. Director ID can be uploaded
            once per director — Document AI will extract the names and ID numbers.
          </p>
        </header>

        {okType && (
          <div className="panel-padded text-sm border border-emerald-700/50 bg-emerald-900/20 text-emerald-200">
            Uploaded <span className="mono">{okType}</span> successfully.
          </div>
        )}
        {errMsg && (
          <div className="panel-padded text-sm border border-rose-700/50 bg-rose-900/20 text-rose-200">
            Upload failed: <span className="mono">{errMsg}</span>
          </div>
        )}

        {/* Required documents */}
        <section className="panel-padded">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Required documents
          </h3>
          <div className="space-y-4">
            {REQUIRED_DOC_TYPES.map((t) => (
              <DocSlot
                key={t}
                docType={t}
                merchantId={id}
                uploaded={byType.get(t) ?? []}
                isDirector={t === 'director_id'}
              />
            ))}
          </div>
        </section>

        {/* Optional documents */}
        <section className="panel-padded">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
            Optional documents
          </h3>
          <div className="space-y-4">
            {OPTIONAL_DOC_TYPES.map((t) => (
              <DocSlot
                key={t}
                docType={t}
                merchantId={id}
                uploaded={byType.get(t) ?? []}
              />
            ))}
          </div>
        </section>

        {/* Directors derived from extracted_data on director_id documents */}
        {directorDocs.length > 0 && (
          <section className="panel-padded">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ogun-muted mb-4">
              Directors (from extracted document data)
            </h3>
            <table className="w-full text-sm">
              <thead className="text-xs text-ogun-muted uppercase">
                <tr>
                  <th className="text-left py-2">Name</th>
                  <th className="text-left py-2">ID number</th>
                  <th className="text-left py-2">Confidence</th>
                  <th className="text-left py-2">Document</th>
                </tr>
              </thead>
              <tbody>
                {directorDocs.map((d) => {
                  const data = d.extracted_data ?? {};
                  return (
                    <tr key={d.id} className="border-t border-ogun-border">
                      <td className="py-2">
                        {String((data as Record<string, unknown>).name ?? '—')}
                      </td>
                      <td className="py-2 mono">
                        {String((data as Record<string, unknown>).id_number ?? '—')}
                      </td>
                      <td className="py-2">
                        {d.extraction_confidence != null
                          ? `${Math.round(d.extraction_confidence * 100)}%`
                          : '—'}
                      </td>
                      <td className="py-2 mono text-xs text-ogun-muted">
                        {d.id}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        <div className="flex items-center justify-end pt-4 border-t border-ogun-border">
          <Link
            href={`/merchants/onboarding/${id}/profile`}
            className="btn btn-primary"
          >
            Continue to Profile →
          </Link>
        </div>
      </div>
    </OnboardingChrome>
  );
}

function DocSlot({
  docType,
  merchantId,
  uploaded,
  isDirector,
}: {
  docType: DocType;
  merchantId: string;
  uploaded: Array<{ id: string; uploaded_at: string; review_status: string }>;
  isDirector?: boolean;
}): React.ReactElement {
  const hasUpload = uploaded.length > 0;
  return (
    <div className="flex items-start gap-4 py-2">
      <div className="flex-1">
        <div className="text-sm font-medium">{DOC_TYPE_LABELS[docType]}</div>
        <div className="text-xs text-ogun-muted mt-0.5">
          {hasUpload
            ? `${uploaded.length} file${uploaded.length === 1 ? '' : 's'} uploaded`
            : 'No file uploaded yet'}
        </div>
        {hasUpload && (
          <ul className="text-xs text-ogun-muted mt-2 space-y-0.5">
            {uploaded.map((u) => (
              <li key={u.id}>
                <span className="mono">{u.id}</span> · {u.review_status}
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        action={uploadDocAction}
        encType="multipart/form-data"
        className="flex items-center gap-2"
      >
        <input type="hidden" name="merchant_id" value={merchantId} />
        <input type="hidden" name="type" value={docType} />
        <input
          type="file"
          name="file"
          required
          className="text-xs text-ogun-muted file:mr-2 file:px-3 file:py-1 file:rounded-md file:border-0 file:bg-ogun-surface file:text-ogun-text"
        />
        <button type="submit" className="btn btn-sm">
          {isDirector && hasUpload ? 'Add another' : 'Upload'}
        </button>
      </form>
    </div>
  );
}
