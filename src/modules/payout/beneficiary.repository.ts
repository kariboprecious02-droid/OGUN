import { query } from '@/infra/db/pool';

export type BeneficiaryRow = {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  beneficiary_type: 'mobile_money' | 'bank_account';
  provider: 'paystack' | 'demo';
  provider_recipient_type: string | null;
  provider_recipient_code: string | null;
  name: string;
  mobile_number: string | null;
  bank_code: string | null;
  account_number: string | null;
  currency: string;
  verification_status: 'pending' | 'verified' | 'failed';
  created_at: Date;
  updated_at: Date;
};

export async function insertBeneficiary(row: {
  id: string;
  merchant_id: string;
  sub_merchant_id: string;
  beneficiary_type: 'mobile_money' | 'bank_account';
  provider: 'paystack' | 'demo';
  provider_recipient_type: string | null;
  provider_recipient_code: string | null;
  name: string;
  mobile_number: string | null;
  bank_code: string | null;
  account_number: string | null;
  currency: string;
  verification_status?: 'pending' | 'verified' | 'failed';
}): Promise<BeneficiaryRow> {
  const { rows } = await query<BeneficiaryRow>(
    `INSERT INTO beneficiaries
       (id, merchant_id, sub_merchant_id, beneficiary_type, provider,
        provider_recipient_type, provider_recipient_code, name,
        mobile_number, bank_code, account_number, currency, verification_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,'pending'))
     RETURNING *`,
    [
      row.id,
      row.merchant_id,
      row.sub_merchant_id,
      row.beneficiary_type,
      row.provider,
      row.provider_recipient_type,
      row.provider_recipient_code,
      row.name,
      row.mobile_number,
      row.bank_code,
      row.account_number,
      row.currency,
      row.verification_status ?? null,
    ],
  );
  return rows[0];
}

export async function findBeneficiary(id: string): Promise<BeneficiaryRow | null> {
  const { rows } = await query<BeneficiaryRow>(
    `SELECT * FROM beneficiaries WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findOrCreateAdHocBeneficiary(input: {
  merchant_id: string;
  sub_merchant_id: string;
  name: string;
  mobile_number?: string;
  bank_code?: string;
  account_number?: string;
  beneficiary_type: 'mobile_money' | 'bank_account';
  currency: string;
}): Promise<BeneficiaryRow> {
  // Try to find an existing one
  const { rows } = await query<BeneficiaryRow>(
    `SELECT * FROM beneficiaries
      WHERE merchant_id = $1 AND sub_merchant_id = $2
        AND beneficiary_type = $3
        AND COALESCE(mobile_number,'') = COALESCE($4,'')
        AND COALESCE(bank_code,'') = COALESCE($5,'')
        AND COALESCE(account_number,'') = COALESCE($6,'')
      LIMIT 1`,
    [
      input.merchant_id,
      input.sub_merchant_id,
      input.beneficiary_type,
      input.mobile_number ?? null,
      input.bank_code ?? null,
      input.account_number ?? null,
    ],
  );
  if (rows[0]) return rows[0];
  // Fall-through: caller should create via insertBeneficiary
  throw new Error('Beneficiary not found');
}

export async function listBeneficiaries(params: {
  merchant_id: string;
  sub_merchant_id?: string;
  page: number;
  limit: number;
}): Promise<{ items: BeneficiaryRow[]; total: number }> {
  const where: string[] = [`merchant_id = $1`];
  const vals: unknown[] = [params.merchant_id];
  let i = 2;
  if (params.sub_merchant_id) {
    where.push(`sub_merchant_id = $${i++}`);
    vals.push(params.sub_merchant_id);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const offset = (params.page - 1) * params.limit;
  const [items, total] = await Promise.all([
    query<BeneficiaryRow>(
      `SELECT * FROM beneficiaries ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${i++} OFFSET $${i++}`,
      [...vals, params.limit, offset],
    ),
    query<{ count: string }>(
      `SELECT count(*)::text AS count FROM beneficiaries ${whereSql}`,
      vals,
    ),
  ]);
  return { items: items.rows, total: Number(total.rows[0]?.count ?? 0) };
}

export async function updateBeneficiary(
  id: string,
  patch: {
    name?: string;
    mobile_number?: string | null;
    bank_code?: string | null;
    account_number?: string | null;
    provider_recipient_code?: string | null;
    verification_status?: 'pending' | 'verified' | 'failed';
  },
): Promise<BeneficiaryRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 2;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = $${i++}`);
    vals.push(v);
  }
  if (!sets.length) {
    return findBeneficiary(id);
  }
  sets.push(`updated_at = now()`);
  const { rows } = await query<BeneficiaryRow>(
    `UPDATE beneficiaries SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...vals],
  );
  return rows[0] ?? null;
}

export async function deleteBeneficiary(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM beneficiaries WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}
