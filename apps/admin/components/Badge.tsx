export function Badge({ status }: { status: string }): React.ReactElement {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function formatCents(amount: number, currency = 'KES'): string {
  return `${currency} ${(amount / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
