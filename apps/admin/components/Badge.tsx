const STATUS_LABELS: Record<string, string> = {
  partial_refund: 'Partial refund',
  refunded: 'Refunded',
  successful: 'Successful',
  failed: 'Failed',
  pending: 'Pending',
};

export function Badge({ status, label }: { status: string; label?: string }): React.ReactElement {
  const text = label ?? STATUS_LABELS[status] ?? status;
  return <span className={`badge badge-${status}`}>{text}</span>;
}

export function formatCents(amount: number, currency = 'KES'): string {
  return `${currency} ${(amount / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
