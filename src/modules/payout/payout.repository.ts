import type { PoolClient } from 'pg';
import { query } from '@/infra/db/pool';
import { PayoutRow, PayoutStatusValue } from './payout.types';

function normalize(row: PayoutRow): PayoutRow {
  return {
    ...row,
    amount: Number(row.amount as unknown as string),
    fee_amount: Number(row.fee_amount as unknown as string),
    total_debit: Number(row.total_debit as unknown as string),
    recipient_amount: Number(row.recipient_amount as unknown as string),
    wallet_reserved_amount: Number(row.wallet_reserved_amount as unknown as string),
  };
}

export async function insertPayout(row: {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  beneficiary_id: string;
  amount: number;
  fee_amount: number;
  total_debit: number;
  recipient_amount: number;
  fee_model: 'merchant_covers' | 'recipient_covers';
  fee_snapshot: Record<string, unknown>;
  currency: string;
  method: string;
  provider: string;
  internal_method: string;
  external_reference: string | null;
  metadata: Record<string, unknown> | null;
  fee_model_source: string;
  idempotency_key: string | null;
}): Promise<PayoutRow> {
  const { rows } = await query<PayoutRow>(
    `INSERT INTO payouts
       (id, merchant_id, sub_merchant_id, beneficiary_id,
        amount, fee_amount, total_debit, recipient_amount, fee_model, fee_snapshot,
        currency, method, provider, internal_method, status,
        external_reference, metadata, fee_model_source, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'created',$15,$16,$17,$18)
     RETURNING *`,
    [
      row.id,
      row.merchant_id,
      row.sub_merchant_id,
      row.beneficiary_id,
      row.amount,
      row.fee_amount,
      row.total_debit,
      row.recipient_amount,
      row.fee_model,
      JSON.stringify(row.fee_snapshot),
      row.currency,
      row.method,
      row.provider,
      row.internal_method,
      row.external_reference,
      row.metadata ? JSON.stringify(row.metadata) : null,
      row.fee_model_source,
      row.idempotency_key,
    ],
  );
  return normalize(rows[0]);
}

export async function findPayout(id: string): Promise<PayoutRow | null> {
  const { rows } = await query<PayoutRow>(`SELECT * FROM payouts WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ? normalize(rows[0]) : null;
}

export async function findPayoutByProviderRef(providerRef: string): Promise<PayoutRow | null> {
  const { rows } = await query<PayoutRow>(
    `SELECT * FROM payouts WHERE provider_reference = $1 LIMIT 1`,
    [providerRef],
  );
  return rows[0] ? normalize(rows[0]) : null;
}

export async function lockPayout(client: PoolClient, id: string): Promise<PayoutRow> {
  const { rows } = await client.query<PayoutRow>(
    `SELECT * FROM payouts WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new Error(`Payout ${id} not found`);
  return normalize(rows[0]);
}

export async function updatePayout(
  client: PoolClient,
  id: string,
  patch: {
    status?: PayoutStatusValue;
    provider_reference?: string | null;
    provider_transfer_code?: string | null;
    provider_status?: string | null;
    wallet_reserved_amount?: number;
    wallet_reserved_at?: Date | null;
    final_resolved_at?: Date | null;
    reversal_indicator?: boolean;
    reversal_reason?: string | null;
    failure_reason?: string | null;
  },
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 2;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = $${i++}`);
    vals.push(v);
  }
  if (!sets.length) return;
  sets.push(`updated_at = now()`);
  await client.query(`UPDATE payouts SET ${sets.join(', ')} WHERE id = $1`, [id, ...vals]);
}

export async function listPayouts(params: {
  merchant_id: string;
  sub_merchant_id?: string;
  status?: PayoutStatusValue;
  page: number;
  limit: number;
}): Promise<{ items: PayoutRow[]; total: number }> {
  const where: string[] = [`merchant_id = $1`];
  const vals: unknown[] = [params.merchant_id];
  let i = 2;
  if (params.sub_merchant_id) {
    where.push(`sub_merchant_id = $${i++}`);
    vals.push(params.sub_merchant_id);
  }
  if (params.status) {
    where.push(`status = $${i++}`);
    vals.push(params.status);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const offset = (params.page - 1) * params.limit;
  const [items, total] = await Promise.all([
    query<PayoutRow>(
      `SELECT * FROM payouts ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...vals, params.limit, offset],
    ),
    query<{ count: string }>(`SELECT count(*)::text as count FROM payouts ${whereSql}`, vals),
  ]);
  return {
    items: items.rows.map(normalize),
    total: Number(total.rows[0]?.count ?? 0),
  };
}
