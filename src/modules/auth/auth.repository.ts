import { query } from '@/infra/db/pool';

export type ApiCredentialRow = {
  id: string;
  merchant_id: string;
  key_type: 'publishable' | 'secret' | 'webhook_secret';
  masked_value: string;
  hashed_value: string;
  environment: 'sandbox' | 'live';
  is_active: boolean;
  created_at: Date;
  rotated_at: Date | null;
};

export async function findCredentialByHash(
  hashedValue: string,
): Promise<ApiCredentialRow | null> {
  const { rows } = await query<ApiCredentialRow>(
    `SELECT * FROM api_credentials WHERE hashed_value = $1 AND is_active = true LIMIT 1`,
    [hashedValue],
  );
  return rows[0] ?? null;
}

export async function insertCredential(row: {
  id: string;
  merchant_id: string;
  key_type: 'publishable' | 'secret' | 'webhook_secret';
  masked_value: string;
  hashed_value: string;
  environment: 'sandbox' | 'live';
}): Promise<void> {
  await query(
    `INSERT INTO api_credentials
       (id, merchant_id, key_type, masked_value, hashed_value, environment)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.id, row.merchant_id, row.key_type, row.masked_value, row.hashed_value, row.environment],
  );
}

export async function deactivateCredentials(
  merchantId: string,
  keyType: 'publishable' | 'secret' | 'webhook_secret',
  environment: 'sandbox' | 'live',
): Promise<void> {
  await query(
    `UPDATE api_credentials
     SET is_active = false, rotated_at = now()
     WHERE merchant_id = $1 AND key_type = $2 AND environment = $3 AND is_active = true`,
    [merchantId, keyType, environment],
  );
}
