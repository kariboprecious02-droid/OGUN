import { query, withTransaction } from '@/infra/db/pool';
import type { PoolClient } from 'pg';
import { MerchantRow, MerchantStatusValue, SubMerchantRow } from './merchant.types';

export async function insertMerchant(row: {
  id: string;
  legal_name: string;
  trading_name: string;
  registration_number?: string | null;
  tax_id?: string | null;
  country?: string;
  settlement_currency?: string;
  business_category?: string | null;
  business_address?: Record<string, unknown> | null;
  website_url?: string | null;
  expected_monthly_volume?: number | null;
  expected_avg_ticket?: number | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}): Promise<MerchantRow> {
  const { rows } = await query<MerchantRow>(
    `INSERT INTO merchants
       (id, legal_name, trading_name, registration_number, tax_id, country,
        settlement_currency, business_category, business_address, website_url,
        expected_monthly_volume, expected_avg_ticket,
        contact_name, contact_email, contact_phone, status)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'KE'),COALESCE($7,'KES'),$8,$9,$10,$11,$12,$13,$14,$15,'draft')
     RETURNING *`,
    [
      row.id,
      row.legal_name,
      row.trading_name,
      row.registration_number ?? null,
      row.tax_id ?? null,
      row.country,
      row.settlement_currency,
      row.business_category ?? null,
      row.business_address ? JSON.stringify(row.business_address) : null,
      row.website_url ?? null,
      row.expected_monthly_volume ?? null,
      row.expected_avg_ticket ?? null,
      row.contact_name ?? null,
      row.contact_email ?? null,
      row.contact_phone ?? null,
    ],
  );
  return rows[0];
}

export async function findMerchant(id: string): Promise<MerchantRow | null> {
  const { rows } = await query<MerchantRow>(`SELECT * FROM merchants WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function updateMerchantStatus(
  client: PoolClient | null,
  id: string,
  next: MerchantStatusValue,
): Promise<void> {
  const runner = client
    ? (sql: string, params: unknown[]) => client.query(sql, params)
    : (sql: string, params: unknown[]) => query(sql, params);
  await runner(
    `UPDATE merchants SET status = $2, updated_at = now() WHERE id = $1`,
    [id, next],
  );
}

export async function insertSubMerchant(row: {
  id: string;
  merchant_id: string;
  name: string;
  code?: string | null;
  settlement_preference?: 'daily' | 'weekly' | 'monthly' | 'on_demand' | null;
  settlement_destination?: Record<string, unknown> | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}): Promise<SubMerchantRow> {
  const { rows } = await query<SubMerchantRow>(
    `INSERT INTO sub_merchants
       (id, merchant_id, name, code, status, settlement_preference, settlement_destination,
        contact_name, contact_email, contact_phone)
     VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      row.id,
      row.merchant_id,
      row.name,
      row.code ?? null,
      row.settlement_preference ?? null,
      row.settlement_destination ? JSON.stringify(row.settlement_destination) : null,
      row.contact_name ?? null,
      row.contact_email ?? null,
      row.contact_phone ?? null,
    ],
  );
  return rows[0];
}

export async function findSubMerchant(id: string): Promise<SubMerchantRow | null> {
  const { rows } = await query<SubMerchantRow>(`SELECT * FROM sub_merchants WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listSubMerchantsByMerchant(merchantId: string): Promise<SubMerchantRow[]> {
  const { rows } = await query<SubMerchantRow>(
    `SELECT * FROM sub_merchants WHERE merchant_id = $1 ORDER BY created_at ASC`,
    [merchantId],
  );
  return rows;
}

export async function activateSubMerchant(client: PoolClient, id: string): Promise<void> {
  await client.query(
    `UPDATE sub_merchants SET status = 'active', updated_at = now() WHERE id = $1`,
    [id],
  );
}

export async function withMerchantTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(fn);
}
