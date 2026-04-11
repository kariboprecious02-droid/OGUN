import type { PoolClient } from 'pg';
import { query } from '@/infra/db/pool';
import {
  CollectionRow,
  CollectionBusinessStatusValue,
  CollectionInternalStatusValue,
} from './collection.types';
import { newId } from '@/infra/ids';

function normalize(row: CollectionRow): CollectionRow {
  return {
    ...row,
    amount: Number(row.amount as unknown as string),
    fee_amount: Number(row.fee_amount as unknown as string),
    customer_amount: Number(row.customer_amount as unknown as string),
    refunded_amount: row.refunded_amount == null ? null : Number(row.refunded_amount as unknown as string),
    poll_attempt_count: Number(row.poll_attempt_count as unknown as string | number),
  };
}

export async function insertCollection(row: {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  amount: number;
  fee_amount: number;
  customer_amount: number;
  currency: string;
  method: string;
  provider: string;
  merchant_reference: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_email: string | null;
  fee_snapshot: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  idempotency_key: string | null;
}): Promise<CollectionRow> {
  const { rows } = await query<CollectionRow>(
    `INSERT INTO collections
       (id, merchant_id, sub_merchant_id, amount, fee_amount, customer_amount,
        currency, method, provider, merchant_reference,
        internal_status, business_status,
        customer_name, customer_phone, customer_email,
        fee_snapshot, metadata, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'created','pending',
             $11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      row.id,
      row.merchant_id,
      row.sub_merchant_id,
      row.amount,
      row.fee_amount,
      row.customer_amount,
      row.currency,
      row.method,
      row.provider,
      row.merchant_reference,
      row.customer_name,
      row.customer_phone,
      row.customer_email,
      JSON.stringify(row.fee_snapshot),
      row.metadata ? JSON.stringify(row.metadata) : null,
      row.idempotency_key,
    ],
  );
  return normalize(rows[0]);
}

export async function findCollection(
  id: string,
  client?: PoolClient,
): Promise<CollectionRow | null> {
  const res = client
    ? await client.query<CollectionRow>(`SELECT * FROM collections WHERE id = $1 LIMIT 1`, [id])
    : await query<CollectionRow>(`SELECT * FROM collections WHERE id = $1 LIMIT 1`, [id]);
  return res.rows[0] ? normalize(res.rows[0]) : null;
}

export async function lockCollection(
  client: PoolClient,
  id: string,
): Promise<CollectionRow> {
  const { rows } = await client.query<CollectionRow>(
    `SELECT * FROM collections WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new Error(`Collection ${id} not found`);
  return normalize(rows[0]);
}

export async function findCollectionByProviderRef(
  providerRef: string,
): Promise<CollectionRow | null> {
  const { rows } = await query<CollectionRow>(
    `SELECT * FROM collections WHERE provider_reference = $1 LIMIT 1`,
    [providerRef],
  );
  return rows[0] ? normalize(rows[0]) : null;
}

export async function updateCollectionStatus(
  client: PoolClient,
  id: string,
  patch: {
    internal_status?: CollectionInternalStatusValue;
    business_status?: CollectionBusinessStatusValue;
    status_reason?: string | null;
    provider_reference?: string | null;
    provider_submission_at?: Date | null;
    final_resolved_at?: Date | null;
    webhook_received_at?: Date | null;
    last_webhook_at?: Date | null;
    polling_stopped_at?: Date | null;
    polling_stop_reason?: string | null;
    settlement_eligible?: boolean;
    settlement_eligible_at?: Date | null;
    wallet_credited?: boolean;
    wallet_credited_at?: Date | null;
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
  await client.query(
    `UPDATE collections SET ${sets.join(', ')} WHERE id = $1`,
    [id, ...vals],
  );
}

export async function insertCollectionAudit(
  client: PoolClient,
  evt: {
    collection_id: string;
    event_source: 'api' | 'webhook' | 'poller' | 'admin' | 'refund' | 'settlement';
    event_type: string;
    previous_internal_status?: CollectionInternalStatusValue | null;
    new_internal_status?: CollectionInternalStatusValue | null;
    previous_business_status?: CollectionBusinessStatusValue | null;
    new_business_status?: CollectionBusinessStatusValue | null;
    provider_payload_hash?: string | null;
    idempotency_key?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO collection_audit_events
       (id, collection_id, event_source, event_type,
        previous_internal_status, new_internal_status,
        previous_business_status, new_business_status,
        provider_payload_hash, idempotency_key, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      newId('collectionAudit'),
      evt.collection_id,
      evt.event_source,
      evt.event_type,
      evt.previous_internal_status ?? null,
      evt.new_internal_status ?? null,
      evt.previous_business_status ?? null,
      evt.new_business_status ?? null,
      evt.provider_payload_hash ?? null,
      evt.idempotency_key ?? null,
      evt.details ? JSON.stringify(evt.details) : null,
    ],
  );
}

export async function listCollections(params: {
  merchant_id: string;
  sub_merchant_id?: string;
  business_status?: CollectionBusinessStatusValue;
  page: number;
  limit: number;
}): Promise<{ items: CollectionRow[]; total: number }> {
  const where: string[] = [`merchant_id = $1`];
  const vals: unknown[] = [params.merchant_id];
  let i = 2;
  if (params.sub_merchant_id) {
    where.push(`sub_merchant_id = $${i++}`);
    vals.push(params.sub_merchant_id);
  }
  if (params.business_status) {
    where.push(`business_status = $${i++}`);
    vals.push(params.business_status);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const offset = (params.page - 1) * params.limit;
  const [items, total] = await Promise.all([
    query<CollectionRow>(
      `SELECT * FROM collections ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...vals, params.limit, offset],
    ),
    query<{ count: string }>(
      `SELECT count(*)::text as count FROM collections ${whereSql}`,
      vals,
    ),
  ]);
  return {
    items: items.rows.map(normalize),
    total: Number(total.rows[0]?.count ?? 0),
  };
}
